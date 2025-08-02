(function() {
    document.documentElement.classList.add('no-transitions');

    try {
        let settings = {
            theme: 'light',
            font: 'lora',
            'font-size': '18',
            align: 'left',
            indent: '0'
        };

        const savedSettings = JSON.parse(localStorage.getItem('readerSettings'));

        if (savedSettings) {
            Object.assign(settings, savedSettings);
        } else {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                settings.theme = 'dark';
            }
        }

        if (settings.theme === 'dark') {
            document.documentElement.classList.add('dark-theme');
        }

        const root = document.documentElement;
        root.style.setProperty('--reader-font-family', `var(--font-family-${settings.font})`);
        root.style.setProperty('--reader-font-size', `${settings['font-size']}px`);
        root.style.setProperty('--reader-text-align', settings.align);
        root.style.setProperty('--reader-paragraph-indent', `${settings.indent}rem`);

    } catch (e) { 
        console.error('Failed to load reader settings:', e);
    }
})();