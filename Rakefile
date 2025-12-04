# frozen_string_literal: true

require 'jekyll'
require 'dotenv'
Dotenv.load

desc 'Build and minify'
task :build do
  puts '[rake] Building Jekyll site...'

  require_relative '_plugins/build_size'
  require_relative '_plugins/fetch_chapters'

  config = Jekyll.configuration({ 'incremental' => true })

  Jekyll::Site.new(config).process

  puts '[rake] Done!'
end

desc 'Serve site locally'
task serve: :build do
  puts '[rake] Starting Jekyll development server...'

  Jekyll::Commands::Serve.process({
                                    'source' => '.',
                                    'destination' => '_site',
                                    'host' => '127.0.0.1',
                                    'port' => '4000'
                                  })
end

desc 'Clean build artifacts'
task :clean do
  FileUtils.rm_rf('_site')
  FileUtils.rm_rf('.jekyll-metadata')
  FileUtils.rm_rf('_chapters')
  FileUtils.rm_rf('assets/index')
  puts '[rake] Cleaned.'
end

require 'aws-sdk-s3'
require 'mime-types'
require 'digest'

BUILD_DIR = '_site'
THREADS_COUNT = 10

desc 'Deploy built site to S3 bucket'
task deploy: :build do

  puts '[deploy] Starting smart deployment to S3...'

  access_key = ENV['S3_ACCESS_KEY_ID'] || ENV['SWIFT_ACCESS_KEY_ID']
  secret_key = ENV['S3_SECRET_ACCESS_KEY'] || ENV['SWIFT_SECRET_ACCESS_KEY']
  region     = ENV['S3_REGION']
  bucket     = ENV['S3_BUCKET_NAME']
  endpoint   = ENV['S3_ENDPOINT']

  unless access_key && secret_key && bucket && endpoint && region
    abort '[deploy] Error: Credentials or Bucket meta not found in ENV.'
  end

  client_options = {
    access_key_id: access_key,
    secret_access_key: secret_key,
    region: region,
    force_path_style: true
  }
  client_options[:endpoint] = endpoint if endpoint

  s3 = Aws::S3::Client.new(client_options)

  puts '[deploy] Fetching remote bucket state...'
  remote_files = {}

  s3.list_objects_v2(bucket: bucket).each do |response|
    response.contents.each do |obj|
      remote_files[obj.key] = obj.etag.tr('"', '')
    end
  end

  puts '[deploy] Analyzing local files...'
  local_files = Dir.glob("#{BUILD_DIR}/**/*").select { |f| File.file?(f) }

  to_upload = []
  to_delete = []
  skipped_count = 0

  local_keys = []

  local_files.each do |file_path|
    key = file_path.sub("#{BUILD_DIR}/", '')
    local_keys << key

    local_md5 = Digest::MD5.file(file_path).hexdigest

    if remote_files[key] == local_md5
      skipped_count += 1
    else
      to_upload << { path: file_path, key: key }
    end
  end

  remote_files.each_key do |remote_key|
    to_delete << remote_key unless local_keys.include?(remote_key)
  end

  puts '[deploy] Analysis complete:'
  puts "         - To Upload: #{to_upload.size}"
  puts "         - To Delete: #{to_delete.size}"
  puts "         - Skipped:   #{skipped_count} (Unchanged)"

  run_parallel = lambda do |items, operation_name, &block|
    queue = Queue.new
    items.each { |i| queue << i }

    total = items.size
    return if total.zero?

    processed = AtomicInteger.new(0)
    mutex = Mutex.new

    workers = (1..THREADS_COUNT).map do
      Thread.new do
        until queue.empty?
          begin
            item = queue.pop(true)
          rescue ThreadError
            break
          end

          block.call(item)

          current = processed.increment
          percent = ((current.to_f / total) * 100).to_i

          mutex.synchronize do
            print "\r[deploy] #{operation_name}: #{percent}% (#{current}/#{total})".ljust(50)
          end
        end
      end
    end
    workers.each(&:join)
    puts ''
  end

  if to_delete.any?
    puts '[deploy] Pruning old files...'
    run_parallel.call(to_delete, 'Deleting') do |key|
      s3.delete_object(bucket: bucket, key: key)
    end
  end

  if to_upload.any?
    puts '[deploy] Uploading new/changed files...'
    run_parallel.call(to_upload, 'Uploading') do |item|
      content_type = MIME::Types.type_for(item[:path]).first&.content_type || 'application/octet-stream'

      File.open(item[:path], 'rb') do |body|
        s3.put_object(
          bucket: bucket,
          key: item[:key],
          body: body,
          content_type: content_type,
          acl: 'public-read'
        )
      end
    end
  end

  puts '[deploy] Deployment complete!'
end

class AtomicInteger
  def initialize(value = 0)
    @value = value
    @mutex = Mutex.new
  end

  def increment
    @mutex.synchronize { @value += 1 }
  end
end
