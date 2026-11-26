import {conditions,WeatherService,rainAmount,weatherMetric} from './weather.js';
import {findWeather} from './search.js';
import {rainMap,showResults} from './maps.js';

const $=id=>document.getElementById(id);
const weather=new WeatherService();
const tints=['--yellow','--sky','--sky','--lilac','--mint','--lilac','--mint','--sky','--peach'];
let origin, route, rain, resultMap, search, lookup;
const options=$('weather-options');
const mapPicker=$('map-weather');
let mapTarget=$('map-temperature').valueAsNumber;
Object.keys(conditions).forEach((category,i)=>{
  mapPicker.add(new Option(category,category,false,category==='Rain'));
  const label=document.createElement('label');
  const input=document.createElement('input');
  Object.assign(input,{name:'weather',type:'radio',value:category,checked:i===0});
  const display=document.createElement('span');
  display.style.setProperty('--tile','var('+tints[i]+')');
  const icon=document.createElement('img');
  icon.src='./assets/'+(i===0?'sun':category.toLowerCase().replace(' ','-'))+'.svg';
  icon.alt='';
  display.append(icon,document.createTextNode(category));
  label.append(input,display);
  options.append(label);
  input.addEventListener('change',()=>{
    $('temperature-field').hidden=category!=='Temperature';
    $('pick').style.setProperty('--tint','var('+tints[i]+')');
  });
});
function routeToHash() {
  if (location.hash==='#main') return;
  const next=['pick','nearby'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  if (next===route) return;
  rain?.remove();
  rain=undefined;
  search?.abort();
  for (const page of ['home','pick','nearby']) $(page).hidden=page!==next;
  const prior=route;
  route=next;
  window.scrollTo(0,0);
  if (prior) $(route).querySelector('h1').focus({preventScroll:true});
  if (route==='nearby') loadRain();
  if (route==='pick') resultMap?.invalidateSize({pan:false});
}
window.addEventListener('hashchange',routeToHash);

const dialog=$('location-dialog');
function openLocation() {
  if (!dialog.open) {
    $('location-status').textContent='';
    dialog.showModal();
  }
}
function setLocation(place) {
  origin=place;
  document.querySelector('[data-place]').textContent=origin.name;
  dialog.close();
  search?.abort();
  clearResults();
  if (route==='nearby') loadRain();
}
document.querySelector('[data-location]').onclick=openLocation;
$('close-location').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{lookup?.abort();});
$('gps').onclick=()=>{
  const button=$('gps'), status=$('location-status');
  if (!navigator.geolocation) {status.textContent='This browser cannot share your location. Enter a city below.';return;}
  status.textContent='Waiting for your location…';
  button.disabled=true;
  navigator.geolocation.getCurrentPosition(({coords})=>{
    button.disabled=false;
    if (!dialog.open) return;
    setLocation({name:'My location',lat:coords.latitude,lon:coords.longitude});
  },()=>{
    button.disabled=false;
    if (dialog.open) status.textContent='Your location is unavailable. Enter a city or postal code below.';
  },{timeout:8500,maximumAge:60000});
};
$('city-form').onsubmit=async event=>{
  event.preventDefault();
  lookup?.abort();
  lookup=new AbortController();
  const {signal}=lookup, status=$('location-status'), list=$('cities');
  const query=$('city').value.trim();
  list.replaceChildren();
  if (query.length<2) {status.textContent='Enter at least two characters.';return;}
  status.textContent='Looking for places…';
  try {
    const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({
      name:query,count:6,language:'en'
    }),{signal:AbortSignal.any([signal,AbortSignal.timeout(9000)])});
    if (!response.ok) throw new Error();
    const {results=[]}=await response.json();
    signal.throwIfAborted();
    status.textContent=results.length?'Choose your starting location.':'No places found. Try a nearby city or add the country.';
    for (const place of results) {
      const li=document.createElement('li'), button=document.createElement('button');
      button.textContent=[...new Set([place.name,place.admin1,place.country].filter(Boolean))].join(', ');
      button.onclick=()=>setLocation({name:place.name,lat:place.latitude,lon:place.longitude,zone:place.timezone});
      li.append(button);
      list.append(li);
    }
  } catch {
    if (!signal.aborted) status.textContent='The city search is unavailable. Try again shortly.';
  }
};
function loadRain() {
  rain?.remove();
  rain=undefined;
  $('rain-map').hidden=!origin;
  for (const id of ['refresh','recenter']) $(id).disabled=!origin;
  if (!origin) {
    $('rain-status').textContent='Set a starting location to see nearby weather.';
    openLocation();
    return;
  }
  rain=rainMap(origin,weather,{status:$('rain-status'),list:$('rain-list'),details:$('rain-details')},mapSelection());
}
function mapSelection() {
  return {category:mapPicker.value,target:mapTarget};
}
function updateMapSelection() {
  const selection=mapSelection();
  const rainSelected=selection.category==='Rain';
  $('map-temperature-field').hidden=selection.category!=='Temperature';
  $('map-match-label').textContent=rainSelected?'Rain':'Matches '+selection.category.toLowerCase();
  $('map-other-label').textContent=rainSelected?'No rain sampled':'Other conditions';
  rain?.select(selection);
}
mapPicker.onchange=updateMapSelection;
$('map-temperature').onchange=()=>{
  if (!$('map-temperature').reportValidity()) return;
  mapTarget=$('map-temperature').valueAsNumber;
  updateMapSelection();
};
$('refresh').onclick=()=>rain?.refresh();
$('recenter').onclick=()=>rain?.recenter();
function radiusLabel() {
  $('radius').disabled=$('unlimited').checked;
  $('radius-value').textContent=$('unlimited').checked?'Unlimited':$('radius').value+' mi';
}
$('radius').oninput=radiusLabel;
$('unlimited').onchange=radiusLabel;
$('cancel-search').onclick=()=>search?.abort();
function clearResults() {
  resultMap?.remove();
  resultMap=undefined;
  $('results').hidden=true;
  $('search-status').textContent='';
}
function timeLabel(sample,zone,fallback) {
  return new Intl.DateTimeFormat('en',{timeZone:zone||fallback,weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(sample.time+'Z'));
}
function displayResults(result,category,timeframe,radius,anchor) {
  const list=$('result-list');
  list.replaceChildren();
  $('results').hidden=false;
  $('result-note').textContent='Model estimates for sampled places. Distances are straight-line and a closer place may have similar weather.';
  for (const [index,place] of result.matches.entries()) {
    const {sample}=place;
    const li=document.createElement('li'), title=document.createElement('h3'), details=document.createElement('p');
    title.textContent=(index+1)+'. '+place.name+' ('+place.region+') · '+(place.miles<1?'<1':Math.round(place.miles))+' mi';
    details.textContent=(timeframe==='Now'?'Modeled now':'Forecast')+' · '+timeLabel(sample,place.zone,anchor.zone)+' · '+weatherMetric(sample,category);
    li.append(title,details);
    const hazardous=['Stormy','Foggy','Snowfall'].includes(category) || [45,48,56,57,66,67,75,82,86,95,96,99].includes(sample.weather_code) ||
      sample.wind_speed_10m>=35 || rainAmount(sample)>=(sample.interval===3600?7.5:1.9) ||
      sample.temperature_2m>=103 || (sample.temperature_2m!=null && sample.temperature_2m<=10);
    if (hazardous) {
      const warning=document.createElement('p');
      warning.className='warning';
      warning.textContent='Potential travel hazard. Check official weather alerts and road conditions. Consider delaying travel.';
      li.append(warning);
    } else {
      const link=document.createElement('a');
      link.href='https://www.google.com/maps/dir/?'+new URLSearchParams({api:1,destination:place.lat+','+place.lon});
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.textContent='Directions to '+place.name;
      li.append(link);
    }
    list.append(li);
  }
  resultMap=showResults(anchor,result,radius);
  $('results-title').focus();
}
$('search-form').onsubmit=async event=>{
  event.preventDefault();
  if (search) return;
  if (!origin) {openLocation();return;}
  clearResults();
  const anchor=origin, data=new FormData(event.target), status=$('search-status');
  const category=data.get('weather'), timeframe=data.get('when');
  const radius=Number($('radius').value), unlimited=$('unlimited').checked;
  const target=$('temperature').valueAsNumber;
  if (category==='Temperature'&&!Number.isFinite(target)) {
    status.textContent='Enter a target temperature to search.';
    $('temperature').focus();
    return;
  }
  search=new AbortController();
  const {signal}=search;
  $('search-button').disabled=true;
  $('cancel-search').hidden=false;
  try {
    const result=await findWeather({origin:anchor,category,target,timeframe,radius,unlimited,weather,signal,
      progress:miles=>{status.textContent='Looking for '+category.toLowerCase()+' within '+miles+' mi…';}});
    signal.throwIfAborted();
    const coverage=result.reached?' within '+result.reached+' mi':'';
    const summary=result.count+' destinations sampled'+coverage+'.';
    if (result.failure) status.textContent=result.failure+' '+summary;
    else if (result.matches.length) status.textContent=result.matches.length+' sampled matches. '+summary;
    else status.textContent='No '+category.toLowerCase()+' matches in the places sampled. '+summary+
      (unlimited?' The search reached its practical limit.':' Try a wider radius or a different timeframe.');
    if (result.matches.length) displayResults(result,category,timeframe,unlimited?Math.max(result.reached,Math.ceil(result.matches.at(-1).miles)):radius,anchor);
  } catch(error) {
    status.textContent=signal.aborted?'Search canceled.':error.message;
  } finally {
    search=undefined;
    $('search-button').disabled=false;
    $('cancel-search').hidden=true;
  }
};
routeToHash();
