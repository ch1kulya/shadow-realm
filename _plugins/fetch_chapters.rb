# frozen_string_literal: true

module ChaptersFetcher
  class Fetcher
    def initialize(site)
      @site = site
      @api_base = ENV['API_URL']
      @novel_id = ENV['NOVEL_ID']
      @api_token = ENV['API_TOKEN']

      @chapters_dir = File.join(site.source, '_chapters')
      FileUtils.mkdir_p(@chapters_dir)

      if @api_token.nil? || @api_token.empty?
        puts "[chapters] \e[33mWARNING: API_TOKEN not set. Running in safe mode to avoid 429 errors.\e[0m"
        @concurrency = 1
        @delay = 0.5
      else
        @concurrency = [(ENV['CHAPTERS_CONCURRENCY'] || '8').to_i, 1].max
        @delay = 0
      end

      @downloaded = 0
      @skipped = 0
      @errors = 0
      @mutex = Mutex.new
      @queue = Queue.new
    end

    def run
      puts "[chapters] Fetching chapters list from API (#{@api_base})..."

      all_chapters = fetch_chapters_list

      if all_chapters.empty?
        puts "[chapters] No chapters found or error fetching list."
        return
      end

      puts "[chapters] Found #{all_chapters.size} chapters in API."

      to_download_count = 0
      all_chapters.each do |ch|
        unless File.exist?(File.join(@chapters_dir, format_filename(ch['chapter_num'])))
          @queue << ch
          to_download_count += 1
        end
      end

      @skipped = all_chapters.size - to_download_count

      if to_download_count == 0
        puts "[chapters] All chapters are up to date."
        return
      end

      puts "[chapters] Downloading #{to_download_count} new chapters using #{@concurrency} persistent workers..."

      workers = (1..@concurrency).map do |i|
        Thread.new { worker_loop(i) }
      end

      workers.each(&:join)

      puts "[chapters] Summary:"
      puts "  Downloaded: #{@downloaded}"
      puts "  Skipped: #{@skipped}"
      puts "  Errors: #{@errors}"
    end

    private

    def worker_loop(id)
      uri = URI(@api_base)

      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 10, read_timeout: 30) do |http|
        while !@queue.empty?
          begin
            chapter_info = @queue.pop(true)
          rescue ThreadError
            break
          end

          process_chapter_with_connection(http, chapter_info)
        end
      end
    rescue => e
      puts "[chapters] Worker #{id} error: #{e.message}"
    end

    def process_chapter_with_connection(http, info)
      sleep(@delay) if @delay > 0

      id = info['id']
      num = info['chapter_num']

      req = Net::HTTP::Get.new("/chapters/#{id}")
      req['X-Service-Token'] = @api_token if @api_token && !@api_token.empty?
      req['Connection'] = 'keep-alive'

      begin
        response = http.request(req)

        if response.is_a?(Net::HTTPSuccess)
          chapter_data = JSON.parse(response.body)
          save_to_file(chapter_data)

          @mutex.synchronize { @downloaded += 1 }
          puts "[chapters] Downloaded chapter #{num}"
        else
          @mutex.synchronize { @errors += 1 }
          puts "[chapters] Failed to download chapter #{num} (ID: #{id}) - Status: #{response.code}"
        end
      rescue => e
        @mutex.synchronize { @errors += 1 }
        puts "[chapters] Error processing chapter #{num}: #{e.message}"
      end
    end

    def fetch_chapters_list
      uri = URI("#{@api_base}/novels/#{@novel_id}/chapters")
      req = Net::HTTP::Get.new(uri)
      req['X-Service-Token'] = @api_token if @api_token && !@api_token.empty?

      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|
        http.request(req)
      end

      if res.is_a?(Net::HTTPSuccess)
        json = JSON.parse(res.body)
        json['chapters'] || []
      else
        puts "[chapters] HTTP Error fetching list: #{res.code}"
        []
      end
    rescue => e
      puts "[chapters] Network error fetching list: #{e.message}"
      []
    end

    def format_filename(num)
      format("%04d.md", num)
    end

    def save_to_file(data)
      num = data['chapter_num']
      title = data['title'].to_s.gsub('"', '\"')
      content = data['content']

      filename = format_filename(num)
      path = File.join(@chapters_dir, filename)

      file_content = <<~MARKDOWN
        ---
        layout: chapter
        title: "#{title}"
        chapter_number: #{num}
        ---
        #{content}
      MARKDOWN

      File.write(path, file_content)
    end
  end
end

Jekyll::Hooks.register :site, :after_init do |site|
  ChaptersFetcher::Fetcher.new(site).run
end
