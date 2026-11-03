import { VOICE_SECONDS } from '@/lib/atlas-voice-demo';
type Call={id:string;name:string;args:unknown};
type Options={ onState:(state:string)=>void; onText:(role:'user'|'atlas',text:string)=>void; onTool:(call:Call)=>unknown; onCancel:(ids:string[])=>void; onError:(message:string)=>void };
export class AtlasLive {
  private ws:WebSocket|null=null;
  private audio:AudioContext|null=null;
  private stream:MediaStream|null=null;
  private capture:AudioWorkletNode|null=null;
  private sources=new Set<AudioBufferSourceNode>();
  private nextPlay=0; private stopped=false; private ready=false; private muted=false; private lastActivity=Date.now();
  private abort=new AbortController();
  private timers:ReturnType<typeof setTimeout>[]=[];
  private watchdog:ReturnType<typeof setInterval>|null=null;
  constructor(private options:Options){}
  async start(bearer:string,teachings:string[]){
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext)throw new Error('Este navegador no permite usar el micrófono. Abre el panel en Chrome o Edge mediante HTTPS.');
      this.options.onState('Pidiendo micrófono');
      this.audio=new AudioContext();await this.audio.resume();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(this.stopped){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      stream.getAudioTracks().forEach(t=>{t.onended=()=>this.stop('El micrófono se ha desconectado.');});
      await this.audio.audioWorklet.addModule('/atlas-voice-capture.js');
      if(this.stopped)return;
      this.options.onState('Conectando');
      const response=await fetch('/api/admin/atlas/voice',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({mode:'fictional',freeTierConfirmed:true,teachings}),signal:this.abort.signal});
      const data=await response.json();
      if(this.stopped)return;
      if(!response.ok)throw new Error(data.error||'No se pudo conectar la voz.');
      if(typeof data.token!=='string'||!data.token.startsWith('auth_tokens/')||data.mode!=='fictional')throw new Error('La autorización de voz no es válida.');
      this.ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(data.token));
      this.ws.binaryType='arraybuffer';
      this.ws.onopen=()=>this.send({setup:{model:data.model}});
      this.ws.onmessage=e=>{if(this.stopped)return;try{const raw=typeof e.data==='string'?e.data:new TextDecoder().decode(e.data);this.receive(JSON.parse(raw));}catch{this.stop('No se pudo procesar la respuesta de voz.');}};
      this.ws.onerror=()=>this.stop('No se pudo conectar con Gemini Live. Revisa tu conexión y el cupo gratuito.');
      this.ws.onclose=()=>{if(!this.stopped)this.stop('La sesión de voz terminó. Puedes iniciar otra cuando quieras.');};
      this.timers.push(setTimeout(()=>{if(!this.ready)this.stop('Google no respondió a tiempo. Vuelve a intentarlo en un minuto.');},20000));
      this.timers.push(setTimeout(()=>this.stop('Terminó la prueba de cinco minutos.'),Math.min(VOICE_SECONDS*1000,Math.max(0,Date.parse(data.expiresAt)-Date.now()))));
      this.watchdog=setInterval(()=>{if(Date.now()-this.lastActivity>90000)this.stop('Micrófono cerrado tras 90 segundos sin conversación.');},5000);
    }catch(e){if(!this.stopped)this.stop(e instanceof Error&&e.name==='NotAllowedError'?'El micrófono no tiene permiso. Actívalo para este sitio y vuelve a iniciar.':e instanceof Error?e.message:'No se pudo iniciar la voz.');}
  }
  private send(body:unknown){if(!this.stopped&&this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(body));}
  private receive(data:any){
    if(data.error){this.stop('Gemini rechazó la sesión. Revisa la disponibilidad de Gemini Live y el cupo del proyecto.');return;}
    if(data.setupComplete&&!this.ready){
      this.ready=true;this.lastActivity=Date.now();
      this.capture=new AudioWorkletNode(this.audio!,'atlas-capture');
      const source=this.audio!.createMediaStreamSource(this.stream!);
      const silent=this.audio!.createGain();silent.gain.value=0;
      source.connect(this.capture);this.capture.connect(silent);silent.connect(this.audio!.destination);
      this.capture.port.onmessage=e=>{
        if(this.stopped||this.muted||!this.ready)return;
        if(!this.ws||this.ws.bufferedAmount>256000){this.stop('La conexión va demasiado lenta. He cerrado el micrófono para evitar acumular audio.');return;}
        const bytes=new Uint8Array(e.data);const samples=new Int16Array(e.data);
        if(samples.some(s=>Math.abs(s)>500))this.lastActivity=Date.now();
        let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
        this.send({realtimeInput:{audio:{data:btoa(binary),mimeType:'audio/pcm;rate=16000'}}});
      };
      this.options.onState('Escuchando');
      this.send({clientContent:{turns:[{role:'user',parts:[{text:'Salúdame como Atlas. Explica en una frase que practicamos con datos ficticios y pregunta qué quiero probar.'}]}],turnComplete:true}});
    }
    const content=data.serverContent;
    if(content){
      if(content.interrupted){this.clearPlayback();this.options.onState(this.muted?'Micrófono pausado':'Escuchando');}
      if(content.inputTranscription?.text){this.lastActivity=Date.now();this.options.onText('user',content.inputTranscription.text);}
      if(content.outputTranscription?.text)this.options.onText('atlas',content.outputTranscription.text);
      for(const part of content.modelTurn?.parts||[]){
        if(part.inlineData?.data&&/^audio\/pcm/.test(part.inlineData.mimeType||''))this.play(part.inlineData.data,part.inlineData.mimeType);
      }
      if(content.turnComplete&&!this.sources.size)this.options.onState(this.muted?'Micrófono pausado':'Escuchando');
    }
    if(data.toolCall?.functionCalls){
      const calls:Call[]=data.toolCall.functionCalls;
      if(!Array.isArray(calls)||calls.length>10){this.stop('Se recibió una petición de herramientas inválida.');return;}
      const responses=calls.map(call=>({id:call.id,name:call.name,response:this.options.onTool(call)}));
      this.send({toolResponse:{functionResponses:responses}});
    }
    if(data.toolCallCancellation?.ids)this.options.onCancel(data.toolCallCancellation.ids);
    if(data.goAway)this.stop('Google está cerrando esta sesión. La prueba conserva sus resultados en pantalla; inicia otra para continuar.');
  }
  private play(encoded:string,mime:string){
    if(!this.audio||this.stopped)return;
    const decoded=atob(encoded);if(decoded.length%2||decoded.length>2000000)throw new Error('Invalid audio');
    const rate=Number(/rate=(\d+)/.exec(mime)?.[1]||24000);
    if(rate<8000||rate>48000)throw new Error('Invalid sample rate');
    if(this.nextPlay-this.audio.currentTime>20){this.stop('La respuesta de audio se ha acumulado. Inicia otra prueba.');return;}
    const buffer=this.audio.createBuffer(1,decoded.length/2,rate), samples=buffer.getChannelData(0);
    for(let i=0;i<samples.length;i++){let v=decoded.charCodeAt(i*2)|(decoded.charCodeAt(i*2+1)<<8);if(v>=32768)v-=65536;samples[i]=v/32768;}
    const source=this.audio.createBufferSource();source.buffer=buffer;source.connect(this.audio.destination);this.sources.add(source);
    this.nextPlay=Math.max(this.nextPlay,this.audio.currentTime);source.start(this.nextPlay);this.nextPlay+=buffer.duration;
    this.options.onState('Atlas está hablando');
    source.onended=()=>{this.sources.delete(source);source.disconnect();if(!this.stopped&&!this.sources.size)this.options.onState(this.muted?'Micrófono pausado':'Escuchando');};
  }
  private clearPlayback(){for(const source of this.sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}this.sources.clear();this.nextPlay=0;}
  setMuted(muted:boolean){this.muted=muted;this.stream?.getAudioTracks().forEach(t=>t.enabled=!muted);this.capture?.port.postMessage(!muted);if(muted)this.send({realtimeInput:{audioStreamEnd:true}});this.options.onState(muted?'Micrófono pausado':'Escuchando');}
  sendResult(result:unknown){if(this.ready){this.lastActivity=Date.now();this.send({clientContent:{turns:[{role:'user',parts:[{text:'Resultado de mi confirmación en la interfaz (solo simulación): '+JSON.stringify(result)}]}],turnComplete:true}});}}
  stop(message?:string){
    if(this.stopped)return;this.stopped=true;this.ready=false;this.abort.abort();this.timers.forEach(clearTimeout);if(this.watchdog)clearInterval(this.watchdog);
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.capture?.disconnect();if(this.capture)this.capture.port.onmessage=null;
    this.clearPlayback();if(this.audio)void this.audio.close().catch(()=>{});if(this.ws){this.ws.onclose=null;this.ws.onerror=null;this.ws.onmessage=null;try{this.ws.close();}catch{}}
    this.options.onState('Desconectado');if(message)this.options.onError(message);
  }
}
