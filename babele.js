Hooks.once('init', () => {
    if(typeof Babele !== 'undefined') {
        Babele.get().register({
            module: 'PF2e-KR',
            lang: 'ko',
            dir: 'compendium'
        });        
    }
});
