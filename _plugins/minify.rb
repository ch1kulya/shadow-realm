require 'minify_html'
require 'uglifier'
require 'sassc'

Jekyll::Hooks.register :site, :post_write do |site|
  puts "🚀 Starting minification process..."
  
  html_count = 0
  css_count = 0
  js_count = 0
  total_saved = 0
  
  Dir.glob(File.join(site.dest, '**/*.html')).each do |file|
    begin
      content = File.read(file)
      original_size = content.bytesize
      
      minified = minify_html(content, {
        :keep_spaces_between_attributes => false,
        :minify_js => false,
        :minify_css => true,
        :remove_comments => true,
        :collapse_whitespace => true,
        :remove_quotes => true,
        :remove_script_attributes => true,
        :remove_style_attributes => true,
        :keep_closing_tags => false,
        :remove_redundant_attributes => true,
        :decode_entities => true
      })
      
      File.write(file, minified)
      new_size = minified.bytesize
      saved = original_size - new_size
      saved_percent = ((saved.to_f / original_size) * 100).round(2)
      total_saved += saved
      html_count += 1
    rescue => e
      puts "Error minifying HTML #{file}: #{e.message}"
    end
  end
  
  Dir.glob(File.join(site.dest, '**/*.css')).each do |file|
    next if file.include?('.min.css')
    
    begin
      content = File.read(file)
      original_size = content.bytesize
      
      minified = SassC::Engine.new(content, {
        syntax: :scss,
        style: :compressed,
        load_paths: [File.dirname(file)]
      }).render
      
      File.write(file, minified)
      new_size = minified.bytesize
      saved = original_size - new_size
      saved_percent = ((saved.to_f / original_size) * 100).round(2)
      total_saved += saved
      css_count += 1
    rescue => e
      puts "Error minifying CSS #{file}: #{e.message}"
    end
  end
  
  Dir.glob(File.join(site.dest, '**/*.js')).each do |file|
    next if file.include?('.min.js')
    
    begin
      content = File.read(file)
      original_size = content.bytesize
      
      minified = Uglifier.new(
        harmony: true,
        compress: {
          drop_console: false,
          drop_debugger: true
        },
        mangle: true,
        output: {
          comments: :none
        }
      ).compile(content)
      
      File.write(file, minified)
      new_size = minified.bytesize
      saved = original_size - new_size
      saved_percent = ((saved.to_f / original_size) * 100).round(2)
      total_saved += saved
      js_count += 1
    rescue => e
      puts "Error minifying JS #{file}: #{e.message}"
    end
  end
  
  puts "\n✅ Minification completed!"
  puts "   Processed: #{html_count} HTML, #{css_count} CSS, #{js_count} JS files"
  puts "   Total saved: #{(total_saved / 1024.0).round(2)} KB"
end