# frozen_string_literal: true

require 'net/http'
require 'uri'
require 'json'
require 'fileutils'

module ChaptersFetcher
  class Fetcher
    def initialize(site)
      @site = site
      @api_base = ENV['API_URL']
      @novel_id = ENV['NOVEL_ID']
      @api_token = ENV['API_TOKEN']

      @chapters_dir = File.join(site.source, '_chapters')
      @index_dir = File.join(site.source, 'assets', 'index')
      @index_file = File.join(@index_dir, 'chapters.json')

      FileUtils.mkdir_p(@chapters_dir)
      FileUtils.mkdir_p(@index_dir)

      if @api_token.nil? || @api_token.empty?
        puts "[chapters] \e[33mWARNING: API_TOKEN not set. Running in safe mode.\e[0m"
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
      puts '[chapters] Fetching chapters list from API...'

      all_chapters = fetch_chapters_list

      if all_chapters.empty?
        puts '[chapters] No chapters found.'
        return
      end

      puts "[chapters] Found #{all_chapters.size} chapters."

      generate_index(all_chapters)

      to_download_count = 0
      all_chapters.each do |ch|
        unless File.exist?(File.join(@chapters_dir, format_filename(ch['chapter_num'])))
          @queue << ch
          to_download_count += 1
        end
      end

      @skipped = all_chapters.size - to_download_count

      if to_download_count.zero?
        puts '[chapters] Content up to date.'
        return
      end

      puts "[chapters] Downloading #{to_download_count} new chapters..."

      workers = (1..@concurrency).map do |i|
        Thread.new { worker_loop(i) }
      end
      workers.each(&:join)

      puts "[chapters] Done: +#{@downloaded}, S:#{@skipped}, E:#{@errors}"
    end

    private

    def generate_index(chapters)
      puts '[chapters] Generating optimized chapters.json...'

      index_data = chapters
                   .sort_by { |ch| ch['chapter_num'] }
                   .map do |ch|
        {
          'number' => ch['chapter_num'],
          'title' => ch['title']
        }
      end

      File.write(@index_file, JSON.pretty_generate(index_data))
      puts "[chapters] Index saved to #{@index_file} (#{index_data.size} entries)"
    end

    def worker_loop(id)
      uri = URI(@api_base)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 10, read_timeout: 30) do |http|
        until @queue.empty?
          begin
            chapter = @queue.pop(true)
          rescue ThreadError
            break
          end
          process_chapter(http, chapter)
        end
      end
    rescue StandardError => e
      puts "[chapters] Worker #{id} error: #{e.message}"
    end

    def process_chapter(http, info)
      sleep(@delay) if @delay.positive?

      uri = URI.join(@api_base + "/", "chapters/#{info['id']}")
      req = Net::HTTP::Get.new(uri)
      req['X-Service-Token'] = @api_token if @api_token && !@api_token.empty?
      req['Connection'] = 'keep-alive'

      begin
        response = http.request(req)
        if response.is_a?(Net::HTTPSuccess)
          data = JSON.parse(response.body)
          save_to_file(data)
          @mutex.synchronize { @downloaded += 1 }
          puts "[chapters] Downloaded #{info['chapter_num']}"
        else
          @mutex.synchronize { @errors += 1 }
          puts "[chapters] Failed #{info['chapter_num']}: #{response.code}"
        end
      rescue StandardError => e
        @mutex.synchronize { @errors += 1 }
        puts "[chapters] Error #{info['chapter_num']}: #{e.message}"
      end
    end

    def fetch_chapters_list
      uri = URI("#{@api_base}/novels/#{@novel_id}/chapters")
      req = Net::HTTP::Get.new(uri)
      req['X-Service-Token'] = @api_token if @api_token && !@api_token.empty?

      res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') { |http| http.request(req) }

      if res.is_a?(Net::HTTPSuccess)
        JSON.parse(res.body)['chapters'] || []
      else
        puts "[chapters] List fetch failed: #{res.code}"
        []
      end
    rescue StandardError => e
      puts "[chapters] List fetch error: #{e.message}"
      []
    end

    def format_filename(num)
      format('%04d.md', num)
    end

    def save_to_file(data)
      num = data['chapter_num']
      title = data['title'].to_s.gsub('"', '\"')
      content = data['content']
      path = File.join(@chapters_dir, format_filename(num))

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
