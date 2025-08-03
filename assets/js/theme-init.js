(function() {
    document.documentElement.classList.add('no-transitions');

    try {
        let settings = {
            theme: 'system',
            font: 'lora',
            'font-size': '1.125',
            align: 'left',
            indent: '0'
        };

        const savedSettings = JSON.parse(localStorage.getItem('readerSettings'));

        if (savedSettings) {
            if (savedSettings['font-size'] && parseFloat(savedSettings['font-size']) > 2) {
                savedSettings['font-size'] = (parseFloat(savedSettings['font-size']) / 16).toFixed(3);
            }
            Object.assign(settings, savedSettings);
        }

        const theme = settings.theme;
        const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (theme === 'dark' || (theme === 'system' && systemPrefersDark)) {
            document.documentElement.classList.add('dark-theme');
        }

        const root = document.documentElement;
        root.style.setProperty('--reader-font-family', `var(--font-family-${settings.font})`);
        root.style.setProperty('--reader-font-size', `${settings['font-size']}rem`);
        root.style.setProperty('--reader-text-align', settings.align);
        root.style.setProperty('--reader-paragraph-indent', `${settings.indent}rem`);

    } catch (e) { 
        console.error('Failed to load reader settings:', e);
    }
})();