const fields = 'rain,showers,temperature_2m,snowfall,wind_speed_10m,cloud_cover,weather_code,is_day';
const hourly = fields + ',snow_depth';
export const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
const rad = Math.PI / 180;
export function distance(a,b) {
  const h = Math.sin((b.lat-a.lat)*rad/2)**2 +
    Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(wrap(b.lon-a.lon)*rad/2)**2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0,h))));
}
const snap = n => Math.round(n*20)/20;
const key = p => [snap(p.lat),wrap(snap(p.lon)).toFixed(2)].join(',');
export class WeatherService {
  cache = new Map();
  pending = new Map();
  usage = [];
  retryAt = 0;
  constructor(request = (...args) => fetch(...args)) { this.request = request; }
  async batch(points, force) {
    const now = Date.now();
    this.usage = this.usage.filter(entry => entry[0] > now-86400000);
    if (now < this.retryAt) throw new Error('Weather service is busy. Try again in a minute.');
    const cost = points.length*2;
    for (const [window, limit] of [[60000,240],[3600000,900],[86400000,2500]]) {
      const used = this.usage.reduce((total, entry) => total + (entry[0] > now-window ? entry[1] : 0), 0);
      if (used+cost > limit) throw new Error('This tab reached its weather request limit. Try again later.');
    }
    this.usage.push([now,cost]);
    const coords = points.map(key).map(item => item.split(','));
    const params = new URLSearchParams({
      latitude:coords.map(pair=>pair[0]), longitude:coords.map(pair=>pair[1]),
      current:fields, hourly, forecast_days:3, timezone:'GMT', cell_selection:'nearest',
      temperature_unit:'fahrenheit', wind_speed_unit:'mph'
    });
    const response = await this.request('https://api.open-meteo.com/v1/forecast?'+params,
      {signal:AbortSignal.timeout(12000), cache:force ? 'reload' : 'default'});
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const delay = retry && (/^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-Date.now());
      this.retryAt = Date.now()+Math.max(60000,delay || 0);
      throw new Error('Weather service is busy. Try again in a minute.');
    }
    if (!response.ok) throw new Error('Weather data is temporarily unavailable. Try again shortly.');
    const body = await response.json();
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== points.length || rows.some(row=>!row.current || !row.hourly?.time)) {
      throw new Error('The weather service returned incomplete data.');
    }
    return rows.map(row=>({ ...row, fetched:Date.now() }));
  }
  get(points, {signal,force=false}={}) {
    signal?.throwIfAborted();
    const requests = new Map();
    for (const point of points) {
      const id = key(point);
      const cached = this.cache.get(id);
      if (this.pending.has(id)) requests.set(id,this.pending.get(id));
      else if (!force && cached && Date.now()-cached.fetched < 600000) requests.set(id,Promise.resolve(cached));
    }
    const missing = [...new Map(points.filter(p=>!requests.has(key(p))).map(p=>[key(p),p])).values()];
    for (let offset=0;offset<missing.length;offset+=12) {
      const group = missing.slice(offset,offset+12);
      const batch = this.batch(group,force);
      group.forEach((point,index)=>{
        const id = key(point);
        const promise = batch.then(rows=>{
          this.cache.delete(id);
          this.cache.set(id,rows[index]);
          if (this.cache.size>650) this.cache.delete(this.cache.keys().next().value);
          return rows[index];
        }).finally(()=>this.pending.delete(id));
        this.pending.set(id,promise);
        requests.set(id,promise);
      });
    }
    const all = Promise.all(points.map(point=>requests.get(key(point))));
    if (!signal) return all;
    return new Promise((resolve,reject)=>{
      const abort = ()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      all.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
}
export function rainAmount(row) {
  return Number.isFinite(row.rain) && Number.isFinite(row.showers) ? row.rain+row.showers : null;
}
export const conditions = {
  Sunny: row=>row.is_day===1 && row.cloud_cover!=null && row.cloud_cover<=25 && [0,1].includes(row.weather_code),
  Rain: row=>rainAmount(row)>=0.1,
  Snowfall: row=>row.snowfall>=0.1,
  Stormy: row=>[95,96,99].includes(row.weather_code),
  Foggy: row=>[45,48].includes(row.weather_code),
  Cloudy: row=>row.cloud_cover>=75,
  Windy: row=>row.wind_speed_10m>=20,
  'Snow cover': row=>row.snow_depth>=0.01,
  Temperature: (row,target)=>row.temperature_2m!=null && Math.abs(row.temperature_2m-target)<=3
};
export function dayAt(time,zone) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
}
const utc = iso => Date.parse(iso+'Z');
export function matching(row,category,target,timeframe,zone,now) {
  const h = row.hourly;
  if (timeframe==='Now') {
    const index = h.time.findLastIndex(time=>utc(time)<=now);
    const sample = {...row.current,snow_depth:h.snow_depth?.[index]};
    if (category==='Snow cover' && index>=0) sample.time=h.time[index];
    return conditions[category](sample,target) ? sample : null;
  }
  const today = dayAt(now,zone);
  const tomorrow = new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const day = timeframe==='Today' ? today : tomorrow;
  for (let i=0;i<h.time.length;i++) {
    const time = utc(h.time[i]);
    if (time<=now || dayAt(time,zone)!==day) continue;
    const sample = {time:h.time[i],interval:3600};
    for (const field of hourly.split(',')) sample[field]=h[field]?.[i];
    if (conditions[category](sample,target)) return sample;
  }
  return null;
}
