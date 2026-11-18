// Only explicit facts and exact catalog names; no fuzzy or work-time selection.
export const normalizeEventText = (value:string) => value.normalize("NFKC").replace(/[\u200e\u200f״׳'".,()]/g,"").replace(/\s+/g," ").trim();
const labels:Record<string,string>={"בר מצווה":"Bar Mitzvah","בר מצוה":"Bar Mitzvah","בת מצווה":"Bat Mitzvah","בת מצוה":"Bat Mitzvah","ברית":"Brit","חתונה":"Wedding","חינה":"Henna","עסקי":"Business"};
export function eventHints(input:{venue?:string|null;eventType?:string|null}){
 let venue=normalizeEventText(input.venue||"");
 const raw=normalizeEventText(input.eventType||"");
 let eventType=raw?(labels[raw]||raw):null;
 for(const [label,type] of Object.entries(labels)){
  if(venue.startsWith(label+" ")){
   venue=venue.slice(label.length).trim();
   eventType=eventType&&eventType!==type?"CONFLICTING_EVENT_TYPE":type;
   break;
  }
 }
 return {venue,eventType};
}
export function matchingVenueNames(input:string,names:string[]){
 const value=normalizeEventText(input);
 const variants=[value,value.replace(/^(?:באולם|אולם)\s+/,""),value.startsWith("ב")?value.slice(1):value];
 for(const variant of variants){const found=names.filter(name=>normalizeEventText(name)===variant);if(found.length)return found;}
 return [];
}
