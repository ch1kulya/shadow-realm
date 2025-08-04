require 'net/http'
require 'uri'
require 'fileutils'
require 'digest'

module ChaptersFetcher
  class Fetcher
    def initialize(site)
      @site = site
      @base_url = ENV['CHAPTERS_BUCKET_URL'].to_s.strip
      raise "CHAPTERS_BUCKET_URL is not set" if @base_url.empty?

      @base_url = @base_url.sub(%r{/\z}, '')

      @chapters_dir = File.join(site.source, '_chapters')
      FileUtils.mkdir_p(@chapters_dir)

      @timeout = (ENV['CHAPTERS_TIMEOUT'] || '20').to_i
      @concurrency = [(ENV['CHAPTERS_CONCURRENCY'] || '8').to_i, 1].max

      @max_consec_not_found = (ENV['CHAPTERS_MAX_CONSEC_NOT_FOUND'] || '10').to_i
      @max_consec_errors = (ENV['CHAPTERS_MAX_CONSEC_ERRORS'] || '10').to_i

      @starting_counter = detect_starting_counter
      env_start = ENV['CHAPTERS_START_FROM']
      if env_start && env_start =~ /^\d+$/
        @starting_counter = env_start.to_i
      end

      @downloaded = 0
      @updated = 0
      @last_checked = nil

      @mutex = Mutex.new
      @q_mutex = Mutex.new
    end

    def run
      puts "[chapters] Chapters dir: #{@chapters_dir}"
      puts "[chapters] Starting from: #{@starting_counter}"
      puts "[chapters] Concurrency: #{@concurrency}, Timeout: #{@timeout}s"

      not_found_streak = 0
      error_streak = 0
      counter = @starting_counter

      loop do
        batch = (0...@concurrency).map { |i| counter + i }
        results = parallel_fetch(batch)

        all_stopped = false

        results.each do |res|
          @last_checked = format('%04d.md', res[:counter])

          case res[:status]
          when :ok_downloaded
            @downloaded += 1
            not_found_streak = 0
            error_streak = 0
          when :ok_updated
            @updated += 1
            not_found_streak = 0
            error_streak = 0
          when :ok_unchanged
            not_found_streak = 0
            error_streak = 0
          when :not_found
            not_found_streak += 1
            error_streak = 0
          when :error
            error_streak += 1
          end

          if not_found_streak >= @max_consec_not_found
            puts "[chapters] Stopping after #{@max_consec_not_found} consecutive not-found/forbidden"
            all_stopped = true
            break
          end

          if error_streak >= @max_consec_errors
            puts "[chapters] Stopping after #{@max_consec_errors} consecutive errors"
            all_stopped = true
            break
          end
        end

        break if all_stopped

        counter += @concurrency
      end

      total_files = Dir.glob(File.join(@chapters_dir, '*.md')).length

      puts ""
      puts "[chapters] Summary:"
      puts "  New files downloaded: #{@downloaded}"
      puts "  Files updated: #{@updated}"
      puts "  Last checked: #{@last_checked}"
      puts "  Total chapter files: #{total_files}"

      if total_files == 0
        raise "No chapter files found!"
      end
    end

    private

    def detect_starting_counter
      files = Dir.glob(File.join(@chapters_dir, '*.md'))
      return 0 if files.empty?

      last_file = files.sort_by { |f| f }.last
      base = File.basename(last_file, '.md')
      number = base.sub(/^0+/, '')
      number = '0' if number.empty?
      number.to_i
    end

    def parallel_fetch(counters)
      threads = []
      results = Array.new(counters.size)

      counters.each_with_index do |num, idx|
        threads << Thread.new do
          results[idx] = fetch_one(num)
        end
      end

      threads.each(&:join)
      results
    end

    def fetch_one(counter)
      formatted = format('%04d', counter)
      url = "#{@base_url}/#{formatted}.md"
      path = File.join(@chapters_dir, "#{formatted}.md")
      tmp = File.join(@chapters_dir, ".#{formatted}.md.tmp")

      begin
        code, body = http_get(url)

        if code == 200
          if body.nil? || body.empty?
            puts "  ! Empty body for #{formatted}.md (200)"
            return { counter: counter, status: :error }
          end

          if File.exist?(path)
            existing = File.binread(path)
            if existing == body
              return { counter: counter, status: :ok_unchanged }
            else
              File.binwrite(tmp, body)
              FileUtils.mv(tmp, path)
              puts "  ~ Updated #{formatted}.md"
              return { counter: counter, status: :ok_updated }
            end
          else
            File.binwrite(tmp, body)
            FileUtils.mv(tmp, path)
            puts "  + Downloaded #{formatted}.md"
            return { counter: counter, status: :ok_downloaded }
          end
        elsif code == 404 || code == 403
          puts "  - Not found #{formatted}.md (#{code})" unless File.exist?(path)
          return { counter: counter, status: :not_found }
        else
          puts "  ! HTTP #{code} for #{formatted}.md"
          return { counter: counter, status: :error }
        end
      rescue => e
        puts "  ! Error fetching #{formatted}.md: #{e.class} #{e.message}"
        return { counter: counter, status: :error }
      ensure
        FileUtils.rm_f(tmp)
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