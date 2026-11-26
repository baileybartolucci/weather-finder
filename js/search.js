import {distance,matching} from './weather.js';

const shards = new Map();
async function placesWithin(origin,radius,signal) {
  // At high latitudes the circle can cross every meridian. Compare to the
  // closest point on each latitude band's enclosing rectangle.
  const bands = [];
  for (let band=-9;band<9;band++) {
    const lat=Math.max(band*10,Math.min(origin.lat,band*10+10));
    if (distance(origin,{lat,lon:origin.lon})<=radius) bands.push(band);
  }
  const files = await Promise.all(bands.map(async band=>{
    if (!shards.has(band)) {
      const promise = fetch(new URL('../data/'+band+'.json',import.meta.url),{signal:AbortSignal.timeout(12000)})
        .then(response=>{
          if (!response.ok) throw new Error('The destination list could not load. Please try again.');
          return response.json();
        }).catch(error=>{shards.delete(band);throw error;});
      shards.set(band,promise);
    }
    return shards.get(band);
  }));
  signal.throwIfAborted();
  return files.flat().map(([name,region,lat,lon,zone])=>({name,region,lat,lon,zone}))
    .map(place=>({...place,miles:distance(origin,place)}))
    .filter(place=>place.miles<=radius).sort((a,b)=>a.miles-b.miles);
}
export async function findWeather({origin,category,target,timeframe,radius,unlimited,weather,signal,progress,places=placesWithin}) {
  const stages = unlimited ? [25,100,250,500,850,1200] : [radius];
  const seen = new Set();
  const matches = [];
  let reached=0, count=0, failure='', cap=false;
  const now=Date.now();
  const zone=origin.zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function check(group) {
    if (!group.length) return;
    signal.throwIfAborted();
    const weatherRows=await weather.get(group,{signal,currentOnly:timeframe==='Now' && category!=='Snow cover'});
    count+=group.length;
    group.forEach((place,i)=>{
      const sample=matching(weatherRows[i],category,target,timeframe,zone,now);
      if (sample) matches.push({...place,sample});
    });
  }
  for (const miles of stages) {
    progress(miles);
    const cities=await places(origin,miles,signal);
    // Stable coordinate identity across expansion stages.
    const todo=cities.filter(city=>!seen.has(identity(city)));
    const spacing=Math.max(3,miles/7);
    const coarse=[];
    const limit=unlimited ? 12 : 60;
    for (const city of todo) {
      if (coarse.length===limit) break;
      if (coarse.length<4 || coarse.every(other=>distance(city,other)>=spacing)) coarse.push(city);
    }
    async function run(group) {
      for (let offset=0;offset<group.length;offset+=12) {
        const chunk=group.slice(offset,offset+12);
        await check(chunk);
        for (const city of chunk) seen.add(identity(city));
      }
    }
    try {
      await run(coarse.slice(0,96-count));
      reached=miles;
      if (!coarse.length) continue;
      const closest=[...matches].sort((a,b)=>a.miles-b.miles).slice(0,4);
      const refinement=todo.filter(city=>!seen.has(identity(city)) &&
        (!closest.length || closest.some(hit=>city.miles <= hit.miles+spacing && distance(city,hit)<=spacing*1.8)));
      await run(refinement.slice(0,Math.min(unlimited?12:36,96-count)));
      if (matches.length) break;
      if (count>=96) {cap=true;break;}
    } catch(error) {
      signal.throwIfAborted();
      failure=error.message;
      break;
    }
  }
  return {matches:matches.sort((a,b)=>a.miles-b.miles).slice(0,12),reached,count,failure,cap};
}
function identity(city) { return city.lat+','+city.lon; }
