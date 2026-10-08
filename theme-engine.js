/** MimaTAVERN v1.3.0 built-in theme engine. */
(() => {
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const BUILTINS=Object.freeze([
    {id:'default',name:'Mima Default',description:'咪嘛馆原始浅色玻璃主题'},
    {id:'midnight',name:'Midnight',description:'炭黑低眩光深色模式'},
    {id:'eink',name:'E-Ink',description:'灰纸深灰字、近零特效的电子墨水阅读模式'},
    {id:'paper',name:'Paper',description:'暖纸色长篇阅读主题'}
  ]);
  const IDS=new Set(BUILTINS.map(x=>x.id));
  function normalizeSettings(input={}){const requested=String(input?.theme||input?.themeId||'default').trim().toLowerCase();return{theme:IDS.has(requested)?requested:'default',globalCssPresetId:typeof input?.globalCssPresetId==='string'?input.globalCssPresetId:null,globalCssEnabled:input?.globalCssEnabled!==false,updatedAt:input?.updatedAt||''};}
  function apply(input={}){
    const settings=normalizeSettings(input);
    if(typeof document!=='undefined'&&document.documentElement){
      if(settings.theme==='default')document.documentElement.removeAttribute('data-mima-theme');else document.documentElement.setAttribute('data-mima-theme',settings.theme);
      document.documentElement.style.colorScheme=settings.theme==='midnight'?'dark':'light';
      const meta=document.querySelector?.('meta[name="theme-color"]');if(meta){const colors={default:'#dfe1e4',midnight:'#111216',eink:'#c8c9c2',paper:'#e8dfcf'};meta.setAttribute('content',colors[settings.theme]||colors.default);}
    }
    return settings;
  }
  function getBuiltins(){return BUILTINS.map(x=>({...x}));}
  root.MimaThemeEngine={normalizeSettings,apply,getBuiltins};
})();
