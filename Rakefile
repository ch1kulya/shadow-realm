require 'jekyll'
require 'dotenv'
Dotenv.load

desc "Build and minify"
task :build do
  puts "[rake] Building Jekyll site..."

  require_relative '_plugins/fetch-chapters'
  require_relative '_plugins/minify'
  require_relative '_plugins/build-size'

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
    'host' => '0.0.0.0',
    'port' => '4000',
    'ssl_cert' => './dev-cert.pem',
    'ssl_key' => './dev-cert-key.pem'
  })
end
