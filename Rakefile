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
