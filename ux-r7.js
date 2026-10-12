/* R7: explicit, opt-in URL for an independently hosted SillyTavern. */
(function(){'use strict';
  function init(){
    const input=document.getElementById('compat-sidecar-url'),button=document.getElementById('compat-sidecar-open'),out=document.getElementById('compat-sidecar-status');
    if(!input||!button||!out)return;
    try{const saved=localStorage.getItem('mima_r7_sidecar_url');if(saved)input.value=saved;}catch{}
    button.addEventListener('click',()=>{
      let target;
      try{
        target=new URL(input.value.trim());
        if(!['http:','https:'].includes(target.protocol)||target.username||target.password||!target.hostname||target.search||target.hash)throw new Error('请输入不包含账号密码、查询参数或片段的 http(s) 服务器地址。');
        const host=target.hostname.toLowerCase().replace(/^\[|\]$/g,'');
        const isLoopback=['127.0.0.1','localhost','::1'].includes(host);
        const privateV4=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
        const privateHost=isLoopback||privateV4||host.endsWith('.local')||host.endsWith('.home.arpa')||host.startsWith('fd')&&host.includes(':');
        if(target.protocol!=='https:'&&!privateHost)throw new Error('公网 HTTP 不安全。请使用 HTTPS 或受信任私有 VPN 地址。');
        const reason=isLoopback?'此链接只会打开当前设备的本机服务；若使用手机连接电脑，请填电脑在受信任网络中的地址。':target.protocol==='http:'?'这是未加密的局域网 HTTP。请确认仅在受信任网络上使用、酒馆已启用认证，且没有向互联网开放端口。':'即将打开外部服务器；请确认其归你管理并启用了认证。';
        out.textContent=reason;
        if(!window.confirm(reason+'\n\n确认打开 '+target.origin+' ？'))return;
        try{localStorage.setItem('mima_r7_sidecar_url',target.origin);}catch{}
        window.open(target.origin+'/','_blank','noopener,noreferrer');
      }catch(e){out.textContent=e.message||'地址不合法。';}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
