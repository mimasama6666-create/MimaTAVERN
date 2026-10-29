/* MimaTAVERN opt-in, read-only performance sampling. No storage, network,
 * content inspection, global API monkey-patching or automatic background work. */
(()=>{'use strict';
  let state=null,observer=null,taskObservers=[],frameTimer=0,frameRaf=0;
  const now=()=>performance.now();
  const finite=n=>Number.isFinite(n)?Math.round(n*10)/10:0;
  function isVisible(){return document.visibilityState==='visible';}
  function visibleElapsed(s){return s.foregroundMs+(s.foregroundAt!==null?now()-s.foregroundAt:0);}
  function onVisibility(){if(!state)return;const s=state;
    if(!isVisible()&&s.foregroundAt!==null){s.foregroundMs+=now()-s.foregroundAt;s.foregroundAt=null;stopFrameSampling();}
    else if(isVisible()&&s.foregroundAt===null){s.foregroundAt=now();scheduleFrameSampling();}
  }
  function stopFrameSampling(){if(frameTimer){clearTimeout(frameTimer);frameTimer=0;}if(frameRaf){cancelAnimationFrame(frameRaf);frameRaf=0;}}
  function scheduleFrameSampling(){stopFrameSampling();if(!state||!isVisible())return;
    // Sampling every 6s for 0.8s avoids a permanent requestAnimationFrame loop.
    frameTimer=setTimeout(()=>{frameTimer=0;const s=state;if(!s||!isVisible())return;
      const end=now()+800;let previous=0;
      function frame(t){frameRaf=0;if(state!==s||!isVisible())return;
        if(previous){const delta=t-previous;s.frames.measured++;s.frames.maxGapMs=Math.max(s.frames.maxGapMs,delta);
          if(delta>50)s.frames.over50++;if(delta>100)s.frames.over100++;}
        previous=t;if(now()<end)frameRaf=requestAnimationFrame(frame);else scheduleFrameSampling();
      }
      frameRaf=requestAnimationFrame(frame);
    },4000);
  }
  function tally(kind,duration=0,extra={}){
    const s=state;if(!s||!isVisible())return;
    const k=['native_refresh','history_hydrate','history_suspend','history_update','compat_render','stream_dom_patch'].includes(kind)?kind:null;
    if(!k)return;
    const entry=s.operations[k];entry.count++;
    if(Number.isFinite(duration)&&duration>=0){entry.measured++;entry.totalMs+=duration;entry.maxMs=Math.max(entry.maxMs,duration);}
    if(k==='native_refresh'){entry.created+=Number(extra.created)||0;entry.reused+=Number(extra.reused)||0;entry.messagesMax=Math.max(entry.messagesMax,Number(extra.messages)||0);}
    if(k==='history_update'){entry.hydrated+=Number(extra.hydrated)||0;entry.suspended+=Number(extra.suspended)||0;}
  }
  function observeMutations(root,id){if(!root||typeof MutationObserver!=='function')return;
    const mo=new MutationObserver(records=>{const s=state;if(!s||!isVisible())return;
      const count=records.length;s.mutations[id].batches++;s.mutations[id].records+=count;
      // Count only mutation records; do not read descendant text or geometry.
      // A bounded traversal prevents the observer itself becoming a hot path.
      for(let i=0;i<Math.min(count,400);i++){const r=records[i];if(r.type==='characterData')s.mutations[id].textChanges++;
        else{s.mutations[id].added+=r.addedNodes.length;s.mutations[id].removed+=r.removedNodes.length;}}
      if(count>400)s.mutations[id].omittedRecords+=count-400;
    });
    mo.observe(root,{subtree:true,childList:true,characterData:true});taskObservers.push(mo);
  }
  function installObservers(){
    if(typeof PerformanceObserver==='function'){
      const supported=PerformanceObserver.supportedEntryTypes||[];
      for(const type of ['longtask','long-animation-frame']){
        if(!supported.includes(type))continue;
        try{const po=new PerformanceObserver(list=>{if(!state||!isVisible())return;for(const entry of list.getEntries()){
          // The browser's observer may include tasks before the current session.
          if(entry.startTime<state.startedAt)continue;
          const metric=type==='longtask'?state.longTasks:state.longFrames;
          metric.count++;metric.maxMs=Math.max(metric.maxMs,entry.duration);metric.totalMs+=entry.duration;
        }});po.observe({type,buffered:false});
          if(type==='longtask')observer=po;else taskObservers.push(po);
        }catch(_){}
      }
    }
    observeMutations(document.getElementById('story-chat-box'),'native');
    observeMutations(document.getElementById('compat-messages'),'compat');
    document.addEventListener('visibilitychange',onVisibility);
  }
  function cleanup(){stopFrameSampling();observer?.disconnect();observer=null;
    for(const o of taskObservers)o.disconnect();taskObservers=[];
    document.removeEventListener('visibilitychange',onVisibility);
  }
  function create(){const operations={};for(const k of ['native_refresh','history_hydrate','history_suspend','history_update','compat_render','stream_dom_patch'])operations[k]={count:0,measured:0,totalMs:0,maxMs:0,created:0,reused:0,messagesMax:0,hydrated:0,suspended:0};
    const mut=()=>({batches:0,records:0,textChanges:0,added:0,removed:0,omittedRecords:0});
    return {startedAt:now(),startedISO:new Date().toISOString(),foregroundAt:isVisible()?now():null,foregroundMs:0,
      operations,mutations:{native:mut(),compat:mut()},frames:{measured:0,over50:0,over100:0,maxGapMs:0},
      longTasks:{count:0,totalMs:0,maxMs:0},longFrames:{count:0,totalMs:0,maxMs:0},
      support:{longTasks:false,longAnimationFrames:false,heap:!!performance.memory},endedISO:null,stoppedDurationMs:null};
  }
  function start(){if(state&&state.endedISO)reset();if(state)return false;
    state=create();installObservers();state.support.longTasks=!!observer;
    state.support.longAnimationFrames=typeof PerformanceObserver==='function'&&taskObservers.some(o=>o instanceof PerformanceObserver);
    scheduleFrameSampling();return true;
  }
  function stop(){if(!state||state.endedISO)return false;const s=state;
    s.stoppedDurationMs=visibleElapsed(s);s.endedISO=new Date().toISOString();
    if(s.foregroundAt!==null){s.foregroundMs=s.stoppedDurationMs;s.foregroundAt=null;}
    cleanup();return true;
  }
  function reset(){if(state&&!state.endedISO)stop();state=null;return true;}
  function statsOf(entry){const e={count:entry.count};if(entry.measured)e.duration={totalMs:finite(entry.totalMs),maxMs:finite(entry.maxMs),avgMs:finite(entry.totalMs/entry.measured)};
    if(entry.created||entry.reused)e.nodes={created:entry.created,reused:entry.reused,messagesMax:entry.messagesMax};
    if(entry.hydrated||entry.suspended)e.messages={hydrated:entry.hydrated,suspended:entry.suspended};return e;}
  function snapshot(){const s=state;if(!s)return {status:'not_started'};
    const active=!s.endedISO,seconds=Math.max(.001,(active?visibleElapsed(s):s.stoppedDurationMs)/1000);
    const op=Object.fromEntries(Object.entries(s.operations).map(([k,v])=>[k,statsOf(v)]));
    const dom={nativeArticleCount:document.querySelectorAll('#story-chat-box > article.message').length,
      nativeLiveCount:document.querySelectorAll('#story-chat-box > article.message[data-mima-native-window="live"]').length,
      compatMessageCount:document.querySelectorAll('#compat-messages > .message').length,
      registeredFontFaces:document.fonts?.size??null,styleSheetCount:document.styleSheets.length};
    const memory=performance.memory?{usedJSHeapBytes:Number(performance.memory.usedJSHeapSize)||null,
      totalJSHeapBytes:Number(performance.memory.totalJSHeapSize)||null,source:'Chromium only; not device RAM'}:null;
    const signals=[];
    if(op.native_refresh.count>=10&&op.native_refresh.count/seconds>1)signals.push('原生剧情刷新频繁；检查生成中的刷新节奏与重新生成 HTML 的范围');
    if(op.stream_dom_patch.duration?.maxMs>50)signals.push('流式正文某次 DOM 更新超过 50ms；可能与 HTML 或大段文本重建有关');
    if(op.native_refresh.duration?.maxMs>50)signals.push('至少一次原生剧情刷新超过 50ms；需要结合具体消息体量确认耗时来源');
    if(op.history_hydrate.count>=30)signals.push('历史消息重新挂载较多；留意滚动边界抖动');
    if(s.frames.measured>=12&&s.frames.over100/s.frames.measured>.1)signals.push('采样期间检测到较多超过 100ms 的帧间隔；可能存在卡顿，但不等于 GPU 重绘次数');
    if(s.longTasks.count)signals.push('浏览器记录到主线程长任务，可能影响触控与滚动响应');
    if(!signals.length)signals.push('当前样本未达到内置提示阈值；不代表已经证明没有性能问题');
    return {diagnostic:'MimaTAVERN-performance-readonly-v1',build:'R19-B8-20261029',active,
      startedAt:s.startedISO,endedAt:s.endedISO,foregroundSeconds:finite(seconds),
      visibilityNow:document.visibilityState,screen:{width:innerWidth,height:innerHeight,devicePixelRatio:devicePixelRatio||1},
      support:{...s.support,notes:'iOS Safari 通常不支持 JS heap / Long Tasks；缺失意味着无法观测，不能写成 0 负载'},
      operations:op,domMutations:s.mutations,frameIntervalSample:{...s.frames,method:'800ms RAF windows every ~5 seconds; not full FPS'},
      browserLongTasks:{count:s.longTasks.count,totalMs:finite(s.longTasks.totalMs),maxMs:finite(s.longTasks.maxMs)},
      browserLongAnimationFrames:{count:s.longFrames.count,totalMs:finite(s.longFrames.totalMs),maxMs:finite(s.longFrames.maxMs)},
      pageSnapshot:dom,memory,signals,
      limitations:['不是电量或 CPU 使用率读数，无法归因到具体 CSS GPU 合成','DOM mutation 是内容变化计数，不是实际绘制次数','只观测主页面的原生与兼容剧情容器；iframe 和小手机内部变化不在统计中','记录仅保存在当前页面内存，刷新会清空；不会上传或写入任何剧情数据']};
  }
  window.MimaPerfDiagnostics=Object.freeze({start,stop,reset,snapshot,mark:tally,isRunning:()=>!!state&&!state.endedISO});
})();
