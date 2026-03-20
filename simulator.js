export function setSimulator({ offline,delay}){
    if(navigator.serviceWorker?.controller){
        navigator.serviceWorker.controller.postMessage({ type: 'SIM_OVERRIDE', payload : { offline,delay}});
    }
}