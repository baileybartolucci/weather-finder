import {wrap,distance,rainAmount,conditions,currentSample,weatherMetric} from './weather.js';
const maxLat=85.051;
const clamp=lat=>Math.max(-maxLat,Math.min(maxLat,lat));
export const latLng=(p,near=p.lon)=>[clamp(p.lat),near+wrap(p.lon-near)];
const popup=text=>{
  const el=document.createElement('div');
  el.textContent=text;
  return el;
};
export function createMap(id,origin,zoom) {
  const map=L.map(id,{scrollWheelZoom:id==='rain-map',maxZoom:16,minZoom:2,zoomAnimation:false}).setView(latLng(origin),zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom:19,keepBuffer:1
  }).addTo(map);
  pin(map,latLng(origin),'user-pin','●','Starting location: '+origin.name,28);
  return map;
}
function pin(map,coords,kind,label,title,size=26) {
  return L.marker(coords,{title,alt:title,icon:L.divIcon({className:kind,html:label,iconSize:[size,size]})})
    .addTo(map).bindPopup(popup(title),{autoPan:false});
}
export function showResults(origin,result,radius) {
  const map=createMap('results-map',origin,8);
  const originCoords=latLng(origin);
  const ring=[];
  // Draw the requested geodesic radius and unwrap it around the origin.
  for (let bearing=0;bearing<360;bearing+=5) {
    const d=radius/3958.76, b=bearing*Math.PI/180, a=origin.lat*Math.PI/180;
    const lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(b));
    const lon=origin.lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat))*180/Math.PI;
    ring.push(latLng({lat:lat*180/Math.PI,lon},origin.lon));
  }
  const circle=L.polygon(ring,{color:'#317a66',fillOpacity:.07,dashArray:'6 6',interactive:false}).addTo(map);
  result.matches.forEach((place,i)=>pin(map,latLng(place,origin.lon),'result-pin',String(i+1),place.name+' · '+Math.round(place.miles)+' mi'));
  map.fitBounds(circle.getBounds().extend(originCoords),{padding:[18,18],maxZoom:10,animate:false});
  return map;
}
export function viewportCells(bounds,zoom,center) {
  const south=clamp(bounds.getSouth()),north=clamp(bounds.getNorth());
  const west=bounds.getWest(), east=bounds.getEast();
  const aspect=Math.max(.18,Math.cos(center.lat*Math.PI/180));
  const base=zoom>=10?.1:zoom>=8?.2:zoom>=6?.5:zoom>=4?2:5;
  let step=base, lngStep=base;
  do {
    lngStep=Math.ceil(step/aspect/.05)*.05;
    if ((Math.ceil((north-south)/step)+2)*(Math.ceil((east-west)/lngStep)+2)<=48) break;
    step+=base;
  } while (step<180);
  const cells=[];
  for (let y=Math.floor(south/step);y<=Math.floor(north/step);y++) {
    for (let x=Math.floor(west/lngStep);x<=Math.floor(east/lngStep);x++) {
      const low=clamp(y*step), high=clamp((y+1)*step);
      if (low>=high) continue;
      const rawLon=(x+.5)*lngStep;
      cells.push({lat:(low+high)/2,lon:wrap(rawLon),rawLon,bounds:[[low,x*lngStep],[high,(x+1)*lngStep]]});
    }
  }
  return cells.sort((a,b)=>distance(center,a)-distance(center,b));
}
const requiredFields = {
  Sunny:['is_day','cloud_cover','weather_code'],Rain:['rain','showers'],
  Snowfall:['snowfall'],Stormy:['weather_code'],Foggy:['weather_code'],
  Cloudy:['cloud_cover'],Windy:['wind_speed_10m'],'Snow cover':['snow_depth'],
  Temperature:['temperature_2m']
};
export function mapSample(record,category,target,now) {
  const sample=currentSample(record,category,now);
  if (!requiredFields[category].every(field=>Number.isFinite(sample[field]))) return null;
  return {sample,match:conditions[category](sample,target)};
}
export function rainMap(origin,weather,elements,selection) {
  const map=createMap('rain-map',origin,8);
  const layer=L.layerGroup().addTo(map);
  let timer, controller, disposed=false, lastRefresh=0;
  async function update(force=false) {
    if (force && Date.now()-lastRefresh<60000) return;
    if (force) lastRefresh=Date.now();
    clearTimeout(timer);
    controller?.abort();
    controller=new AbortController();
    const {signal}=controller;
    const {category,target}=selection;
    const now=Date.now();
    const isRain=category==='Rain';
    const center=map.getCenter();
    const cells=viewportCells(map.getBounds(),map.getZoom(),{lat:center.lat,lon:center.lng});
    elements.status.textContent='Loading modeled '+category.toLowerCase()+'…';
    elements.list.replaceChildren();
    elements.details.hidden=true;
    map.closePopup();
    layer.clearLayers();
    const rectangles=cells.map(cell=>L.rectangle(cell.bounds,{
      color:'#5e6f76',opacity:.65,weight:1,fillColor:'#e3e5df',fillOpacity:.30,dashArray:'3 5'
    }).addTo(layer).bindPopup(popup('No weather data for this sample.')));
    let refreshed=0,failed='',dry=0,wet=0;
    for (let offset=0;offset<cells.length;offset+=12) {
      if (signal.aborted) return;
      const chunk=cells.slice(offset,offset+12);
      try {
        const rows=await weather.get(chunk,{signal,force,currentOnly:category!=='Snow cover'});
        if (signal.aborted) return;
        rows.forEach((record,i)=>{
          const value=mapSample(record,category,target,now), rect=rectangles[offset+i];
          if (!value) return;
          const {sample,match}=value;
          refreshed=refreshed ? Math.min(refreshed,record.fetched) : record.fetched;
          if (!match) {
            dry++;
            rect.setStyle({color:'#7c9895',fillColor:'#e8f7f4',fillOpacity:.16,dashArray:null})
              .setPopupContent(popup(isRain?'No rain sampled here at the map threshold.':'Sample does not match '+category.toLowerCase()+'.'));
            return;
          }
          wet++;
          const detail='Modeled '+category.toLowerCase()+': '+weatherMetric(sample,category);
          rect.setStyle({color:'#245689',fillColor:'#327ccf',fillOpacity:isRain?Math.min(.78,.38+rainAmount(sample)*.12):.53,dashArray:null})
            .setPopupContent(popup(detail));
          const cell=chunk[i];
          const coords=[cell.lat,cell.rawLon];
          pin(layer,coords,'rain-pin','●',detail,21);
          const item=document.createElement('li');
          const btn=document.createElement('button');
          btn.type='button';
          btn.textContent=detail+' · '+Math.round(distance(origin,cell))+' mi away';
          btn.onclick=()=>{L.popup({autoPan:false}).setLatLng(coords).setContent(popup(detail)).openOn(map);};
          item.append(btn);
          elements.list.append(item);
          elements.details.hidden=false;
        });
      } catch(error) {
        if (signal.aborted) return;
        failed=error.message;
        break;
      }
    }
    if (disposed || signal.aborted) return;
    const timestamp=refreshed ? ' Updated '+new Date(refreshed).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+'.' : '';
    elements.status.textContent='Open-Meteo model. '+wet+(isRain?' rain':' matching')+' · '+dry+(isRain?' no rain':' other conditions')+' · '+(cells.length-wet-dry)+' no data.'+timestamp+(failed?' '+failed:'');
  }
  map.on('moveend',()=>{
    clearTimeout(timer);
    controller?.abort();
    timer=setTimeout(update,420);
  });
  void update();
  return {select:next=>{selection=next;return update();},refresh:()=>update(true),recenter:()=>map.setView(latLng(origin),8,{animate:false}),
    remove:()=>{disposed=true;clearTimeout(timer);controller?.abort();map.remove();}};
}
