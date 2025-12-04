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

      @chapters_dir = File.join(site.source, '_chapters')
      FileUtils.mkdir_p(@chapters_dir)

      @concurrency = [(ENV['CHAPTERS_CONCURRENCY'] || '8').to_i, 1].max

      @downloaded = 0
      @skipped = 0
      @errors = 0
      @mutex = Mutex.new
    end

    def run
      puts "[chapters] Fetching chapters list from API (#{@api_base})..."

      all_chapters = fetch_chapters_list

      if all_chapters.empty?
        puts "[chapters] No chapters found or error fetching list."
        return
      end

      puts "[chapters] Found #{all_chapters.size} chapters in API."

      to_download = all_chapters.select do |ch|
        !File.exist?(File.join(@chapters_dir, format_filename(ch['chapter_num'])))
      end

      @skipped = all_chapters.size - to_download.size

      if to_download.empty?
        puts "[chapters] All chapters are up to date."
        return
      end

      puts "[chapters] Downloading #{to_download.size} new chapters with concurrency #{@concurrency}..."

      to_download.each_slice(@concurrency) do |batch|
        threads = batch.map do |chapter_info|
          Thread.new do
            process_chapter(chapter_info)
          end
        end
        threads.each(&:join)
      end

      puts "[chapters] Summary:"
      puts "  Downloaded: #{@downloaded}"
      puts "  Skipped: #{@skipped}"
      puts "  Errors: #{@errors}"
    end

    private

    def fetch_chapters_list
      uri = URI("#{@api_base}/novels/#{@novel_id}/chapters")
      response = Net::HTTP.get_response(uri)

      if response.is_a?(Net::HTTPSuccess)
        json = JSON.parse(response.body)
        json['chapters'] || []
      else
        puts "[chapters] HTTP Error fetching list: #{response.code}"
        []
      end
    rescue => e
      puts "[chapters] Network error fetching list: #{e.message}"
      []
    end

    def process_chapter(info)
      id = info['id']
      num = info['chapter_num']

      uri = URI("#{@api_base}/chapters/#{id}")
      response = Net::HTTP.get_response(uri)

      if response.is_a?(Net::HTTPSuccess)
        chapter_data = JSON.parse(response.body)
        save_to_file(chapter_data)

        @mutex.synchronize { @downloaded += 1 }
        puts "[chapters] Downloaded chapter #{num}"
      else
        @mutex.synchronize { @errors += 1 }
        puts "[chapters] Failed to download chapter #{num} (ID: #{id})"
      end
    rescue => e
      @mutex.synchronize { @errors += 1 }
      puts "[chapters] Error processing chapter #{num}: #{e.message}"
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
