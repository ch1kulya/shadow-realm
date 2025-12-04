# frozen_string_literal: true

require 'jekyll'
require 'dotenv'
Dotenv.load

desc "Build and minify"
task :build do
  puts "[rake] Building Jekyll site..."

  require_relative '_plugins/build_size'
  require_relative '_plugins/fetch_chapters'
  require_relative '_plugins/minify'

  Jekyll::Site.new(Jekyll.configuration).process
  puts "[rake] Done!"
end

desc "Serve site locally"
task :serve => :build do
  puts "[rake] Starting Jekyll development server..."

  Jekyll::Commands::Serve.process({
    'source' => '.',
    'destination' => '_site',
    'watch' => true,
    'incremental' => true,
    'livereload' => false,
    'host' => '127.0.0.1',
    'port' => '4000'
  })
end
