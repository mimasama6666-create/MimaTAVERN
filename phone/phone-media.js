/* Original binary assets, live browser speech recognition and recording. */
(()=>{'use strict';
 const store=()=>MimaPhoneStore;
 async function save(file,ownerId='owner'){
   if(!(file instanceof Blob))throw Error('媒体文件不是有效 Blob');if(file.size>24*1024*1024)throw Error('单个手机附件暂时限制 24MB，原件没有被上传或改变');
   const buffer=await file.arrayBuffer(),bytes=await crypto.subtle.digest('SHA-256',buffer);const hash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
   const row={id:store().id('media'),name:String(file.name||'attachment'),mime:file.type||'application/octet-stream',size:file.size,ownerId,blob:file,hash,createdAt:new Date().toISOString()};await store().write('media',row);return {...row,blob:undefined};
 }
 async function load(assetId){const asset=await store().read('media',assetId);if(!asset)throw Error('附件不存在/存储已损坏');return asset;}
 async function dataURL(assetId){const asset=await load(assetId);if(!asset.mime.startsWith('image/'))throw Error('不是图片附件');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(asset.blob);});}
 async function visionParts(assetIds){const parts=[];for(const a of assetIds){const asset=await load(a);if(!['image/jpeg','image/png','image/webp','image/gif'].includes(asset.mime))throw Error('此图片格式不支持模型请求：'+asset.mime);parts.push({type:'image_url',image_url:{url:await dataURL(a),detail:'auto'}});}return parts;}
 function speechRecognitionAvailable(){return !!(window.SpeechRecognition||window.webkitSpeechRecognition);}
 async function recordAndTranscribe({onTranscript,onStatus,language='zh-CN'}={}){
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('设备浏览器不支持麦克风录音');
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
   let recorder;try{recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});}catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
   const chunks=[],SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
   let recognizer=null,finalTranscript='',speechError='';
   if(SpeechRecognition){recognizer=new SpeechRecognition();recognizer.lang=language;recognizer.continuous=true;recognizer.interimResults=true;
     recognizer.onresult=e=>{let full='';for(let i=0;i<e.results.length;i++){full+=e.results[i][0]?.transcript||'';}finalTranscript=full;onTranscript?.(full);};
     recognizer.onerror=e=>{speechError=e.error||'转写失败';onStatus?.('浏览器语音识别失败：'+speechError);};
   }else{onStatus?.('当前浏览器不支持语音识别，录音能保存，但不能自动转文字。');}
   recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
   const done=new Promise((resolve,reject)=>{recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());resolve({blob:new Blob(chunks,{type:recorder.mimeType||'audio/webm'}),transcript:finalTranscript,speechError});};recorder.onerror=e=>reject(e.error||Error('录音失败'));});
   recorder.start();try{recognizer?.start();}catch(e){speechError=String(e.message||e);onStatus?.('语音识别未启动：'+speechError);}
   return {stop:async()=>{if(recorder.state!=='inactive')recorder.stop();try{recognizer?.stop();}catch(_){}return done;},hasASR:!!recognizer};
 }
 window.MimaPhoneMedia=Object.freeze({save,load,dataURL,visionParts,recordAndTranscribe,speechRecognitionAvailable});
})();
