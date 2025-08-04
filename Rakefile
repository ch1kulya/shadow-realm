require 'jekyll'
require 'dotenv'
Dotenv.load

desc "Build and minify"
task :build do
  puts "Building Jekyll site..."

  require_relative '_plugins/fetch-chapters'
  require_relative '_plugins/minify'
  require_relative '_plugins/build-size'
  
  config = Jekyll.configuration({
    'config' => '_config.yml',
    'source' => '.',
    'destination' => '_site'
  })
  Jekyll::Site.new(config).process
end

desc "Serve site locally"
task :serve do
  puts "Starting Jekyll development server..."
  
  Jekyll::Commands::Serve.process({
    'source' => '.',
    'destination' => '_site',
    'watch' => true,
    'incremental' => true,
    'livereload' => false,
    'host' => 'localhost',
    'port' => '4000'
  })
end