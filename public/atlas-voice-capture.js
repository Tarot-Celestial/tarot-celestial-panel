// PCM mono 16 kHz capture. Runs only after an explicit microphone action.
class AtlasCapture extends AudioWorkletProcessor {
  constructor(){super();this.sum=0;this.count=0;this.phase=0;this.chunk=new Int16Array(1600);this.index=0;this.active=true;
    this.port.onmessage=e=>{this.active=e.data===true;this.sum=0;this.count=0;this.phase=0;this.index=0;};
  }
  process(inputs){
    const samples=inputs[0]?.[0];if(!this.active||!samples)return true;
    for(let i=0;i<samples.length;i++){
      this.sum+=samples[i];this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){
        const v=Math.max(-1,Math.min(1,this.sum/this.count));this.chunk[this.index++]=v<0?v*32768:v*32767;
        this.phase-=sampleRate;this.sum=0;this.count=0;
        if(this.index===this.chunk.length){this.port.postMessage(this.chunk.buffer,[this.chunk.buffer]);this.chunk=new Int16Array(1600);this.index=0;}
      }
    }
    return true;
  }
}
registerProcessor('atlas-capture',AtlasCapture);
