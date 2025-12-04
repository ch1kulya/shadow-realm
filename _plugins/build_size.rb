# frozen_string_literal: true

Jekyll::Hooks.register :site, :post_write do |site|
  total_size = 0

  Dir.glob("#{site.dest}/**/*").each do |file|
    total_size += File.size(file) if File.file?(file)
  end

  build_size_mb = (total_size / 1024.0 / 1024.0).round(2)

  build_size_js_path = File.join(site.dest, 'assets', 'js', 'build-size.js')

  if File.exist?(build_size_js_path)
    content = File.read(build_size_js_path)

    content.gsub!('__BUILD_SIZE_PLACEHOLDER__', build_size_mb.to_s)

    File.write(build_size_js_path, content)

    puts "[build-size] Build size: #{build_size_mb} MB"
  else
    puts "[build-size] build-size.js not found at #{build_size_js_path}"
  end
end
