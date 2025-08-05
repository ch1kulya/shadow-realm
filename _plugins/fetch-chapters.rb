require 'net/http'
require 'uri'
require 'fileutils'
require 'rexml/document'

module ChaptersFetcher
  class Fetcher
    def initialize(site)
      @site = site
      @base_url = ENV['CHAPTERS_BUCKET_URL'].to_s.strip
      raise "CHAPTERS_BUCKET_URL is not set" if @base_url.empty?

      @base_url = @base_url.sub(%r{/\z}, '')

      @chapters_dir = File.join(site.source, '_chapters')
      FileUtils.mkdir_p(@chapters_dir)
      
      @metadata_file = File.join(@chapters_dir, '.metadata.json')

      @timeout = (ENV['CHAPTERS_TIMEOUT'] || '20').to_i
      @concurrency = [(ENV['CHAPTERS_CONCURRENCY'] || '8').to_i, 1].max

      @downloaded = 0
      @updated = 0
      @unchanged = 0
      @errors = 0

      @mutex = Mutex.new
    end

    def run
      puts "[chapters] Chapters dir: #{@chapters_dir}"
      puts "[chapters] Fetching file list from S3..."
      puts "[chapters] Concurrency: #{@concurrency}, Timeout: #{@timeout}s"

      files = fetch_file_list
      
      if files.empty?
        puts "[chapters] No .md files found in bucket"
        return
      end

      puts "[chapters] Found #{files.length} .md files"
      
      local_metadata = load_metadata
      
      files_to_download = files.select { |file_info| needs_download?(file_info, local_metadata) }
      files_to_skip = files.length - files_to_download.length
      
      puts "[chapters] Files to download: #{files_to_download.length}"
      puts "[chapters] Files to skip (unchanged): #{files_to_skip}"
      
      if files_to_download.empty?
        puts "[chapters] Nothing to download"
        return
      end
      
      files_to_download.each_slice(@concurrency) do |batch|
        results = parallel_fetch(batch)
        process_results(results)
      end
      
      @unchanged = files_to_skip
      
      save_metadata(files)
      
      save_metadata(files)

      total_files = Dir.glob(File.join(@chapters_dir, '*.md')).length

      puts "[chapters] Summary:"
      puts "  New files downloaded: #{@downloaded}"
      puts "  Files updated: #{@updated}"
      puts "  Files unchanged: #{@unchanged}"
      puts "  Errors: #{@errors}"
      puts "  Total chapter files: #{total_files}"

      if total_files == 0
        raise "  No chapter files found!"
      end
    end

    private
    
    def load_metadata
      return {} unless File.exist?(@metadata_file)
      
      begin
        require 'json'
        JSON.parse(File.read(@metadata_file))
      rescue => e
        puts "[chapters] Warning: Failed to load metadata: #{e.message}"
        {}
      end
    end
    
    def save_metadata(files)
      begin
        require 'json'
        metadata = {}
        files.each do |file_info|
          metadata[file_info[:key]] = {
            'etag' => file_info[:etag],
            'size' => file_info[:size],
            'last_modified' => file_info[:last_modified]
          }
        end
        File.write(@metadata_file, JSON.pretty_generate(metadata))
      rescue => e
        puts "[chapters] Warning: Failed to save metadata: #{e.message}"
      end
    end
    
    def needs_download?(file_info, local_metadata)
      filename = file_info[:key]
      path = File.join(@chapters_dir, filename)
      
      return true unless File.exist?(path)
      
      saved_meta = local_metadata[filename]
      return true unless saved_meta
      
      return true if saved_meta['etag'] != file_info[:etag]
      return true if saved_meta['size'] != file_info[:size]
      return true if saved_meta['last_modified'] != file_info[:last_modified]
      
      return true if File.size(path) != file_info[:size]
      
      false
    end

    def fetch_file_list
      begin
        all_files = []
        marker = nil
        page = 1
        
        loop do
          url = @base_url
          if marker
            separator = url.include?('?') ? '&' : '?'
            url = "#{url}#{separator}marker=#{URI.encode_www_form_component(marker)}"
          end
          
          puts "[chapters] Requesting bucket listing page #{page}"
          code, body = http_get(url)
          
          if code != 200
            raise "  HTTP #{code} when fetching bucket listing page #{page}"
          end

          if body.nil? || body.empty?
            raise "  Empty response when fetching bucket listing page #{page}"
          end

          # Парсим XML
          doc = REXML::Document.new(body)
          page_files = []
          last_key = nil

          # Извлекаем все Contents элементы
          doc.elements.each('//Contents') do |contents|
            key_element = contents.elements['Key']
            next unless key_element
            
            key = key_element.text
            last_key = key if key
            next unless key && key.end_with?('.md')
            
            # Извлекаем метаданные
            etag_element = contents.elements['ETag']
            size_element = contents.elements['Size']
            modified_element = contents.elements['LastModified']
            
            etag = etag_element ? etag_element.text.gsub('"', '') : nil
            size = size_element ? size_element.text.to_i : nil
            last_modified = modified_element ? modified_element.text : nil
            
            page_files << {
              key: key,
              etag: etag,
              size: size,
              last_modified: last_modified
            }
          end

          all_files.concat(page_files)
          puts "[chapters] Page #{page}: found #{page_files.length} .md files"
          
          is_truncated = false
          truncated_element = doc.elements['//IsTruncated']
          if truncated_element && truncated_element.text
            is_truncated = truncated_element.text.downcase == 'true'
          end
          
          break unless is_truncated
          
          if last_key
            marker = last_key
            page += 1
          else
            puts "[chapters] Warning: IsTruncated=true but no keys found, stopping"
            break
          end
        end

        all_files.sort_by { |f| f[:key] }
      rescue => e
        puts "[chapters] Failed to fetch file list: #{e.class} #{e.message}"
        raise
      end
    end

    def parallel_fetch(file_infos)
      threads = []
      results = Array.new(file_infos.size)

      file_infos.each_with_index do |file_info, idx|
        threads << Thread.new do
          results[idx] = fetch_one(file_info)
        end
      end

      threads.each(&:join)
      results
    end

    def fetch_one(file_info)
      filename = file_info[:key]
      url = "#{@base_url}/#{filename}"
      path = File.join(@chapters_dir, filename)
      tmp = File.join(@chapters_dir, ".#{filename}.tmp")

      begin
        code, body = http_get(url)

        if code == 200
          if body.nil? || body.empty?
            return { filename: filename, status: :error }
          end

          if File.exist?(path)
            File.binwrite(tmp, body)
            FileUtils.mv(tmp, path)
            return { filename: filename, status: :ok_updated }
          else
            File.binwrite(tmp, body)
            FileUtils.mv(tmp, path)
            return { filename: filename, status: :ok_downloaded }
          end
        else
          return { filename: filename, status: :error }
        end
      rescue => e
        return { filename: filename, status: :error }
      ensure
        FileUtils.rm_f(tmp)
      end
    end

    def process_results(results)
      @mutex.synchronize do
        results.each do |res|
          case res[:status]
          when :ok_downloaded
            @downloaded += 1
          when :ok_updated
            @updated += 1
          when :ok_unchanged
            @unchanged += 1
          when :error
            @errors += 1
          end
        end
      end
    end

    def http_get(url_str)
      uri = URI(url_str)
      http = Net::HTTP.new(uri.host, uri.port)
      http.read_timeout = @timeout
      http.open_timeout = @timeout
      http.use_ssl = (uri.scheme == 'https')

      req = Net::HTTP::Get.new(uri.request_uri)
      res = http.request(req)

      body = res.body
      [res.code.to_i, body]
    end
  end
end

Jekyll::Hooks.register :site, :after_init do |site|
  begin
    ChaptersFetcher::Fetcher.new(site).run
  rescue => e
    warn "[chapters] Failed: #{e.class} #{e.message}"
    raise
  end
end