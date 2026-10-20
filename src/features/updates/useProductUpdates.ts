"use client";
import {useEffect,useState} from 'react';
import {apiRequest} from '@/lib/client-api';
import {ProductUpdatesSchema} from '@/contracts/api/product-updates';
import type {z} from 'zod';
/** Never announce unreleased assets: only the currently serving Worker supplies notes. */
export function useProductUpdates(includeRuntime=false){
 const [data,setData]=useState<z.infer<typeof ProductUpdatesSchema>|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let active=true,busy=false;
  const controller=new AbortController();
  async function refresh(){
   if(busy||document.visibilityState==='hidden')return;
   busy=true;
   try{const value=ProductUpdatesSchema.parse(await apiRequest(includeRuntime?'/api/product-updates/runtime':'/api/product-updates',{authenticated:true,signal:controller.signal}));if(active){setData(value);setError(false);}}
   catch{if(active)setError(true);}finally{busy=false;}
  }
  void refresh();
  const onVisible=()=>{void refresh();};
  const timer=setInterval(onVisible,60_000);
  window.addEventListener('focus',onVisible);document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);};
 },[includeRuntime]);
 return{data,error};
}
