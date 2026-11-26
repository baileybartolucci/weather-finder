import test from 'node:test';
import assert from 'node:assert/strict';
import {WeatherService,conditions,distance,matching,rainAmount} from '../js/weather.js';
import {findWeather} from '../js/search.js';
import {viewportCells} from '../js/maps.js';

const baseline={rain:0,showers:0,weather_code:0,is_day:1,cloud_cover:10,temperature_2m:70,snowfall:0,wind_speed_10m:2};
const row={current:{...baseline,time:'2026-11-26T21:15',interval:900},
  hourly:{time:['2026-11-26T21:00','2026-11-26T23:00','2026-11-27T13:00'],snow_depth:[.02,0,0],rain:[0,1,2],showers:[0,0,0]}};
test('all categories have deterministic independent thresholds',()=>{
  const cases={Sunny:{},Rain:{rain:.1},Snowfall:{snowfall:.1},Stormy:{weather_code:95},Foggy:{weather_code:48},
    Cloudy:{cloud_cover:75},Windy:{wind_speed_10m:20},'Snow cover':{snow_depth:.01},Temperature:{temperature_2m:73}};
  for(const [category,values] of Object.entries(cases)) {
    assert.equal(conditions[category]({...baseline,...values},70),true,category);
    assert.equal(conditions[category]({},70),false,category);
  }
  assert.equal(conditions.Sunny({...baseline,is_day:0}),false);
  assert.equal(conditions.Snowfall({...baseline,snow_depth:.2}),false);
  assert.equal(rainAmount({rain:null,showers:0}),null);
});
test('local today and tomorrow select future hours and now uses existing snow cover',()=>{
  const now=Date.parse('2026-11-26T21:17Z');
  assert.equal(matching(row,'Snow cover',0,'Now','America/New_York',now).time,'2026-11-26T21:00');
  assert.equal(matching(row,'Rain',0,'Today','America/New_York',now).rain,1);
  assert.equal(matching(row,'Rain',0,'Tomorrow','America/New_York',now).rain,2);
  assert.equal(matching(row,'Rain',0,'Now','GMT',now),null);
});
test('great-circle distance wraps and rain grid is bounded with zoom-dependent resolution',()=>{
  assert.ok(distance({lat:0,lon:179.9},{lat:0,lon:-179.9})<15);
  const bounds={getSouth:()=>39,getNorth:()=>41,getWest:()=>179,getEast:()=>182};
  const cells=viewportCells(bounds,8,{lat:40,lon:180});
  assert.ok(cells.length>1&&cells.length<=48);
  assert.ok(cells.some(cell=>cell.lon<0));
  const coarse=viewportCells(bounds,4,{lat:40,lon:180});
  assert.ok(coarse.length<cells.length);
});
test('weather cache coalesces callers and refreshes explicitly',async()=>{
  let calls=0;
  const service=new WeatherService(async()=>{
    calls++;
    return new Response(JSON.stringify(row));
  });
  const p=[{lat:40.002,lon:170.006}];
  await Promise.all([service.get(p),service.get(p)]);
  await service.get([{lat:40,lon:170}]);
  assert.equal(calls,1);
  await service.get(p,{force:true});
  assert.equal(calls,2);
});
test('canceled weather caller can leave an in-flight batch for another feature',async()=>{
  const controller=new AbortController();
  let finish;
  const service=new WeatherService(()=>new Promise(resolve=>{finish=resolve;}));
  const points=[{lat:1,lon:1}];
  const canceled=service.get(points,{signal:controller.signal});
  const surviving=service.get(points);
  controller.abort();
  await assert.rejects(canceled,{name:'AbortError'});
  finish(new Response(JSON.stringify(row)));
  assert.equal((await surviving)[0].current.rain,0);
});
test('weighted local limit and 429 backoff block further network I/O',async()=>{
  let calls=0;
  const service=new WeatherService(async url=>{
    calls++;
    const n=new URL(url).searchParams.get('latitude').split(',').length;
    return new Response(JSON.stringify(Array(n).fill(row)));
  });
  await service.get(Array.from({length:120},(_,i)=>({lat:10,lon:i/10})));
  await assert.rejects(service.get([{lat:2,lon:2}]),/request limit/);
  assert.equal(calls,10);
  const busy=new WeatherService(async()=>{
    calls++;
    return new Response('',{status:429,headers:{'Retry-After':'120'}});
  });
  await assert.rejects(busy.get([{lat:0,lon:0}]),/busy/);
  await assert.rejects(busy.get([{lat:0,lon:0}]),/busy/);
  assert.equal(calls,11);
});
test('search expands progressively, samples only within each radius, and reports the area checked',async()=>{
  const progress=[];
  const origin={lat:0,lon:0,zone:'GMT'};
  const cities=[{lat:0,lon:.1,miles:7},{lat:0,lon:1,miles:69},{lat:0,lon:2,miles:138}];
  const options={origin,category:'Rain',timeframe:'Now',radius:25,unlimited:true,
    signal:new AbortController().signal,progress:miles=>progress.push(miles),
    places:async(_,radius)=>cities.filter(city=>city.miles<=radius),
    weather:{get:async points=>points.map(p=>({...row,current:{...row.current,rain:p.lon===1?2:0}}))}};
  const result=await findWeather(options);
  assert.deepEqual(progress,[25,100]);
  assert.deepEqual(result.matches.map(place=>place.miles),[69]);
  assert.equal(result.count,2);
  const bounded=await findWeather({...options,unlimited:false});
  assert.equal(bounded.matches.length,0);
  assert.equal(bounded.reached,25);
  assert.equal((await findWeather({...options,unlimited:false,radius:500})).reached,500);
});
test('search preserves prior coverage on failure and honors cancellation',async()=>{
  const signal=new AbortController().signal;
  const options={origin:{lat:0,lon:0,zone:'GMT'},category:'Rain',timeframe:'Now',radius:500,unlimited:true,signal,progress:()=>{},
    places:async(_,r)=>[{lat:0,lon:r/100,miles:r}],
    weather:{get:async group=>{if (group[0].miles>25) throw new Error('Weather busy');return [row];}}};
  const result=await findWeather(options);
  assert.equal(result.failure,'Weather busy');
  assert.equal(result.reached,25);
  const controller=new AbortController();
  await assert.rejects(findWeather({...options,signal:controller.signal,progress:()=>controller.abort()}),{name:'AbortError'});
});
