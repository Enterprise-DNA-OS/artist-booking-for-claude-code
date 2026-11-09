#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {getDb, REPO_ROOT} from './lib/db.mjs';
import {parseCsv} from './lib/csv.mjs';
import {page,table,writeOut} from './lib/render.mjs';
import {table as textTable} from './lib/format.mjs';
export const entities=JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'entities.json'),'utf8'));
export const reads={
 'week': "select code,artist,local_start,timezone,venue,status,owner from booking_desk where status in ('hold','confirmed') and ends_at>=current_timestamp and starts_at<current_timestamp+interval '14 days' order by starts_at,code",
 'holds': "select code,artist,local_start,hold_until,owner from booking_desk where status='hold' order by hold_until nulls first,code",
 'clashes': 'select booking,conflicts_with,artist from booking_clashes order by booking',
 'contracts-due': "select code,artist,promoter,local_start,status from booking_desk where status in ('hold','confirmed') and contract_on is null order by starts_at",
 'deposits-due': "select code,promoter,currency,deposit_due,deposit_outstanding_cents from booking_desk where status in ('hold','confirmed') and deposit_outstanding_cents>0 order by deposit_due,code",
 'advance-review': 'select code,booking,artist,category,due_on,owner from preparation_queue where completed_on is null order by due_on,code',
 'travel-review': "select j.code,b.code booking,j.origin,j.destination,j.departs_at,j.arrives_at,j.arrives_at>b.starts_at late from journeys j join bookings b on b.id=j.booking_id where b.status in ('hold','confirmed') order by j.departs_at",
 'balances': "select code,promoter,currency,fee_cents,received_cents,balance_cents from booking_desk where status<>'cancelled' order by starts_at",
 'owner-load': "select owner,count(*)::integer shows,sum(open_advance)::integer open_advance from booking_desk where status in ('hold','confirmed') group by owner order by owner",
 'promoter-exposure': "select promoter,currency,count(*)::integer shows,sum(deposit_outstanding_cents)::bigint deposits_due_cents,sum(balance_cents)::bigint balance_cents from booking_desk where status in ('hold','confirmed') group by promoter,currency order by promoter,currency",
 'ready': "select code,artist,local_start,(status='confirmed' and contract_on is not null and contract_ref<>'' and contract_actor<>'' and safety_reviewed and open_advance=0 and deposit_outstanding_cents=0 and not exists(select 1 from booking_clashes c where c.booking=booking_desk.code or c.conflicts_with=booking_desk.code) and not exists(select 1 from journeys j where j.booking_id=booking_desk.id and j.arrives_at>booking_desk.starts_at) and ends_at>current_timestamp) ready from booking_desk where status in ('hold','confirmed') order by starts_at",
 'privacy-review': "select * from findings where rule='PRIVACY-REVIEW' order by record",
 'compliance': 'select * from findings order by rule,record',
 'attention': 'select * from findings order by rule,record',
 'activity': 'select entity,record_id,actor,action,note,created_at from activity order by created_at,id'
};
export const commands=[...Object.keys(reads),'help','list','show','add','update','log','record-contract','confirm','cancel','complete-show','record-receipt','complete-advance','draft-itinerary','draft-advance-request','import','export','weekly-review'];
function required(o,k){if(o[k]===undefined||o[k]===null||!String(o[k]).trim())throw Error(`Missing --${k.replaceAll('_','-')}`);return String(o[k]).trim();}
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Use a valid YYYY-MM-DD date');return v;}
function timestamp(v){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Timestamp needs a valid date and explicit timezone offset');date(v.slice(0,10));return new Date(v).toISOString();}
function today(){return new Date().toISOString().slice(0,10);}
function pastDate(v){date(v);if(v>today())throw Error('Recorded decision date cannot be in the future');return v;}
function money(v){if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)>900000000000)throw Error('Money must be nonnegative whole cents below the supported limit');return Number(v);}
function currency(v){v=v.toUpperCase();if(!/^[A-Z]{3}$/.test(v))throw Error('Currency must be a three-letter code');return v;}
function code(v){v=v.toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]*$/.test(v))throw Error('Code uses letters, numbers, hyphens and underscores only');return v;}
async function resolve(db,kind,ref){if(!entities[kind])throw Error('Unknown kind');let r=await db.query(`select * from ${kind} where lower(code)=lower($1) or id::text=$1`,[ref]);if(!r.length)r=await db.query(`select * from ${kind} where lower(name)=lower($1)`,[ref]);if(!r.length)r=await db.query(`select * from ${kind} where left(id::text,length($1))=$1 or position(lower($1) in lower(name))>0 order by code`,[ref]);if(r.length!==1)throw Error(`${r.length?'Ambiguous':'No match'} ${kind}: ${ref}${r.length?'\n'+r.map(x=>`${x.code} | ${x.name} | ${x.id}`).join('\n'):''}`);return r[0];}
async function audit(db,entity,id,actor,action,before,after,note=''){await db.query('insert into activity(entity,record_id,actor,action,note,before_row,after_row) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[entity,id,actor,action,note,JSON.stringify(before),JSON.stringify(after)]);}
async function transaction(db,fn){await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}}
// Locks keep two simultaneous CLI operators from confirming overlapping shows or over-recording receipts.
async function lock(db){await db.exec('LOCK TABLE artists,promoters,venues,bookings,advance_items,journeys,receipts,activity IN SHARE ROW EXCLUSIVE MODE');}
async function cleanFields(db,kind,o){const out={};for(const [key,type]of Object.entries(entities[kind])){if(o[key]===undefined)continue;let value=String(o[key]).trim();if(entities[type])value=(await resolve(db,type,value)).id;else if(type==='date')value=value===''?null:date(value);else if(type==='timestamp')value=timestamp(value);else if(type==='money')value=money(value);else if(type==='currency')value=currency(value);else if(type==='kind'&&!['technical','hospitality','safety','access','other'].includes(value))throw Error('Unknown advance kind');if(key==='timezone'){try{new Intl.DateTimeFormat('en',{timeZone:value}).format();}catch{throw Error('Unknown IANA timezone');}}out[key]=value;}return out;}
async function insert(db,kind,values){const keys=Object.keys(values);return (await db.query(`insert into ${kind} (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(values)))[0];}
async function update(db,kind,id,values){const keys=Object.keys(values);return(await db.query(`update ${kind} set ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$${keys.length+1} returning *`,[...Object.values(values),id]))[0];}
function knownFlags(cmd,o){const read=Object.hasOwn(reads,cmd),common=['json'];const sets={help:[],list:['kind'],show:['kind','ref'],add:['kind','code','actor',...new Set(Object.values(entities).flatMap(Object.keys))],update:['kind','ref','actor',...new Set(Object.values(entities).flatMap(Object.keys))],log:['kind','ref','actor','note'],'record-contract':['ref','actor','on','document'],confirm:['ref','actor'],cancel:['ref','actor','note'],'complete-show':['ref','actor'],'record-receipt':['ref','actor','on','reference','amount_cents'],'complete-advance':['ref','actor','on','evidence'],'draft-itinerary':['ref'],'draft-advance-request':['ref'],import:['file','map','sheet','owner','actor','dry_run','hold_until'],export:['dir'],'weekly-review':[]};const allowed=new Set([...common,...(read?[]:(sets[cmd]||[]))]);for(const k of Object.keys(o))if(!allowed.has(k))throw Error(`Unknown flag --${k.replaceAll('_','-')} for ${cmd}`);}
export async function run(db,cmd,o={},pos=[]){if(!commands.includes(cmd))throw Error(`Unknown command ${cmd}. Use help.`);knownFlags(cmd,o);
 if(Object.hasOwn(reads,cmd))return db.query(reads[cmd]);
 if(cmd==='help')return commands.map(command=>({command}));
 if(cmd==='weekly-review'){const result=[];for(const c of ['week','attention','deposits-due'])for(const row of await run(db,c))result.push({section:c,...row});return result;}
 if(cmd==='list'){const kind=required(o,'kind');if(!entities[kind])throw Error('Unknown kind');return db.query(`select * from ${kind} order by code`);}
 if(cmd==='show')return[await resolve(db,required(o,'kind'),required(o,'ref'))];
 if(cmd==='export')return exportAll(db,o);
 if(cmd==='import'){if(pos[0]!=='systemone')throw Error('Use import systemone');return importShows(db,o);}
 if(cmd.startsWith('draft-'))return draft(db,cmd,o);
 const actor=required(o,'actor');
 return transaction(db,async()=>{await lock(db);
  if(['add','update','log'].includes(cmd)){
   const kind=required(o,'kind');if(!entities[kind])throw Error('Unknown kind');
   if(cmd!=='log')for(const k of Object.keys(o))if(!['kind','ref','actor','code','json'].includes(k)&&!Object.hasOwn(entities[kind],k))throw Error(`Field ${k} does not belong to ${kind}`);
   const before=cmd==='add'?null:await resolve(db,kind,required(o,'ref'));
   if(cmd==='log'){const note=required(o,'note');await audit(db,kind,before.id,actor,'log',before,before,note);return[{code:before.code,logged:true}];}
   const fields=await cleanFields(db,kind,o);if(!Object.keys(fields).length)throw Error('No fields supplied');
   if(kind==='bookings'&&before&&Object.keys(fields).some(k=>!['notes','owner','hold_until'].includes(k))){if(['completed','cancelled'].includes(before.status))throw Error('Closed shows cannot have terms changed');fields.status='hold';fields.contract_ref='';fields.contract_on=null;fields.contract_actor='';if((fields.fee_cents??before.fee_cents)<Number((await db.query('select coalesce(sum(amount_cents),0) n from receipts where booking_id=$1',[before.id]))[0].n))throw Error('Fee cannot be below recorded receipts');}
   if(kind==='advance_items'&&before){fields.completed_on=null;fields.evidence_ref='';fields.completed_by='';}
   const after=cmd==='add'?await insert(db,kind,{code:code(required(o,'code')),...fields}):await update(db,kind,before.id,fields);
   await audit(db,kind,after.id,actor,cmd,before,after);
   if(kind==='bookings'&&before&&['artist_id','venue_id','starts_at','ends_at'].some(k=>Object.hasOwn(fields,k)&&String(fields[k])!==String(before[k]))){
    const reviewed=await db.query('select * from advance_items where booking_id=$1 and completed_on is not null',[before.id]);
    for(const item of reviewed){const reset=await update(db,'advance_items',item.id,{completed_on:null,evidence_ref:'',completed_by:''});await audit(db,'advance_items',item.id,actor,'booking-change',item,reset,'Artist, venue or times changed. Review preparation again.');}
   }
   return[after];
  }
  const isAdvance=cmd==='complete-advance';const kind=isAdvance?'advance_items':'bookings';const before=await resolve(db,kind,required(o,'ref'));let after;
  if(isAdvance){const booking=await resolve(db,'bookings',before.booking_id);if(!['hold','confirmed'].includes(booking.status))throw Error('Cannot complete preparation for a closed show');after=await update(db,kind,before.id,{completed_on:pastDate(required(o,'on')),completed_by:actor,evidence_ref:required(o,'evidence')});}
  else if(cmd==='record-contract'){if(!['hold','confirmed'].includes(before.status))throw Error('Cannot change a closed show contract');after=await update(db,kind,before.id,{contract_ref:required(o,'document'),contract_on:pastDate(required(o,'on')),contract_actor:actor});}
  else if(cmd==='confirm'){
   if(before.status!=='hold')throw Error('Only a hold can be confirmed');
   if(!before.hold_until||String(before.hold_until)<today())throw Error('Renew the expired or missing hold deadline first');
   if(!before.contract_ref||!before.contract_on||!before.contract_actor)throw Error('Record the signed contract reference first');
   if(new Date(before.starts_at)<=new Date())throw Error('Cannot confirm a past show');
   const overlaps=await db.query("select code from bookings where artist_id=$1 and id<>$2 and status in ('hold','confirmed') and starts_at<$3 and ends_at>$4",[before.artist_id,before.id,before.ends_at,before.starts_at]);if(overlaps.length)throw Error('Artist overlaps: '+overlaps.map(r=>r.code).join(', '));
   after=await update(db,kind,before.id,{status:'confirmed'});
  }else if(cmd==='cancel'){if(!['hold','confirmed'].includes(before.status))throw Error('Only active shows can be cancelled');after=await update(db,kind,before.id,{status:'cancelled'});required(o,'note');}
  else if(cmd==='complete-show'){if(before.status!=='confirmed')throw Error('Only a confirmed show can be completed');if(new Date(before.ends_at)>new Date())throw Error('Show has not ended');after=await update(db,kind,before.id,{status:'completed'});}
  else if(cmd==='record-receipt'){
   if(before.status==='cancelled')throw Error('Cancelled shows need a separate settlement review');
   const n=money(required(o,'amount_cents'));if(n===0)throw Error('Receipt must be positive');
   const balance=(await db.query('select balance_cents from booking_desk where id=$1',[before.id]))[0];if(n>Number(balance.balance_cents))throw Error('Receipt exceeds outstanding balance');
   const receipt=await insert(db,'receipts',{booking_id:before.id,reference:required(o,'reference'),amount_cents:n,received_on:pastDate(required(o,'on')),actor});await audit(db,'receipts',receipt.id,actor,cmd,null,receipt);return[receipt];
  }else throw Error('Unsupported operation');
  await audit(db,kind,before.id,actor,cmd,before,after,o.note||'');return[after];
 });
}
function csvValue(v){let s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+@\t\r]/.test(s)||(/^[-]/.test(s)&&!/^-[0-9.]+$/.test(s)))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
async function exportAll(db,o){const dir=path.resolve(required(o,'dir'));fs.mkdirSync(dir,{recursive:true,mode:0o700});const all={exported_at:new Date().toISOString(),records:{}};await db.exec('BEGIN READ ONLY');try{for(const t of [...Object.keys(entities),'receipts','activity']){const rows=await db.query(`select * from ${t} order by id`);all.records[t]=rows;const cols=rows.length?Object.keys(rows[0]):(await db.query('select column_name from information_schema.columns where table_schema=current_schema() and table_name=$1 order by ordinal_position',[t])).map(x=>x.column_name);fs.writeFileSync(path.join(dir,t+'.csv'),[cols.map(csvValue).join(','),...rows.map(r=>cols.map(c=>csvValue(r[c])).join(','))].join('\n')+'\n',{mode:0o600});}fs.writeFileSync(path.join(dir,'backup.json'),JSON.stringify(all,null,2)+'\n',{mode:0o600});}finally{await db.exec('ROLLBACK');}return[{directory:dir,records:Object.values(all.records).reduce((n,x)=>n+x.length,0)}];}
const defaultMap={code:'Show ID',name:'Show name',artist:'Artist',promoter:'Promoter',venue:'Venue',starts_at:'Start',ends_at:'End',currency:'Currency',fee:'Fee',source_status:'Status'};
async function sheetRows(file,sheet){if(!/\.xlsx$/i.test(file))return parseCsv(fs.readFileSync(file,'utf8'));const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);const ws=sheet?book.getWorksheet(sheet):book.worksheets[0];if(!ws)throw Error('Workbook sheet not found');const grid=[];ws.eachRow(r=>{const cells=[];for(let i=1;i<=ws.columnCount;i++){const cell=r.getCell(i);if(cell.type===6)throw Error('Formula cells are not accepted in imports; export values only');if(cell.value instanceof Date)throw Error('Excel date cells need explicit timezone text. Export ISO timestamps with offsets.');cells.push(cell.text);}grid.push(cells);});return parseCsv(grid.map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\n'));}
async function importShows(db,o){const file=required(o,'file'),actor=required(o,'actor'),owner=required(o,'owner');const map=o.map?JSON.parse(fs.readFileSync(o.map,'utf8')):defaultMap;for(const k of Object.keys(map))if(!Object.hasOwn(defaultMap,k))throw Error('Unsupported mapping key '+k);const rows=await sheetRows(file,o.sheet);if(!rows.length)throw Error('Import is empty');const hold_until=o.hold_until?date(o.hold_until):null;
 return transaction(db,async()=>{await lock(db);let added=0,unchanged=0;const seen=new Set();for(const raw of rows){const get=k=>{const key=Object.keys(raw).find(x=>x.toLowerCase()===String(map[k]||'').toLowerCase());return key===undefined?'':String(raw[key]).trim();};for(const key of ['code','name','artist','promoter','venue','starts_at','ends_at','currency','fee'])if(!get(key))throw Error(`Import row ${added+unchanged+2}: missing mapped ${key}`);const c=code(get('code'));if(seen.has(c))throw Error('Duplicate show code in import: '+c);seen.add(c);const start=timestamp(get('starts_at')),end=timestamp(get('ends_at'));if(start>=end)throw Error('Show ends before it starts');const fee=get('fee');if(!/^\d+(\.\d{1,2})?$/.test(fee))throw Error('Fee must be unformatted decimal currency, no separators');const cents=money(Math.round(Number(fee)*100));const old=await db.query('select * from bookings where code=$1',[c]);if(old.length){if(JSON.stringify(old[0].source_row)!==JSON.stringify(JSON.parse(JSON.stringify(raw)))){
 // jsonb normalizes key order; compare values rather than key order.
 if(!old[0].source_row||Object.keys(raw).length!==Object.keys(old[0].source_row).length||Object.entries(raw).some(([k,v])=>old[0].source_row[k]!==v))throw Error('Changed source row for '+c+'; reconcile manually');
 }unchanged++;continue;}
 const related={};for(const [field,kind]of [['artist','artists'],['promoter','promoters'],['venue','venues']])related[field+'_id']=(await resolve(db,kind,get(field))).id;
 const values={code:c,name:get('name'),...related,starts_at:start,ends_at:end,currency:currency(get('currency')),fee_cents:cents,owner,hold_until,source_status:get('source_status'),source_row:JSON.stringify(raw)};
 const after=await insert(db,'bookings',values);await audit(db,'bookings',after.id,actor,'import',null,after,'SystemOne export. Source status retained; local status is hold pending review.');added++;}
 if(o.dry_run)throw Object.assign(Error('dry-run'),{preview:[{added,unchanged,dry_run:true}]});return[{added,unchanged,dry_run:false}];}).catch(e=>{if(e.preview)return e.preview;throw e;});}
async function draft(db,cmd,o){await db.exec('BEGIN READ ONLY');try{const b=await resolve(db,'bookings',required(o,'ref'));if(!['hold','confirmed'].includes(b.status))throw Error('Drafts require an active show');const show=(await db.query('select code,artist,venue,local_start,local_end,timezone,status from booking_desk where id=$1',[b.id]));let sections;
 if(cmd==='draft-itinerary'){const ready=(await db.query(reads.ready)).find(r=>r.code===b.code);if(!ready?.ready)throw Error('Itinerary blocked: review ready, attention and preparation records');sections=[{title:'Show',html:table(show)},{title:'Travel, UTC timestamps',html:table(await db.query('select name,departs_at,arrives_at,origin,destination,reference from journeys where booking_id=$1 order by departs_at',[b.id]))}];}
 else sections=[{title:'Show',html:table(show)},{title:'Please review these outstanding details',html:table(await db.query('select name,category,due_on,owner from advance_items where booking_id=$1 and completed_on is null order by due_on',[b.id]))}];
 const file=writeOut('drafts',`${cmd}-${b.code}-${Date.now()}`,page({title:cmd==='draft-itinerary'?'Artist itinerary draft':'Show preparation request draft',subtitle:'Internal draft. Review the recipient and contents before sharing.',sections}));return[{file}];}finally{await db.exec('ROLLBACK');}}
export function format(rows){
 if(!rows.length)return 'No records.';
 const cols=[...new Set(rows.flatMap(Object.keys))];
 return textTable(rows,cols.map(key=>({key,label:key.replace(/_cents$/,'').replaceAll('_',' '),width:80,format:value=>value===null||value===undefined?'':key.endsWith('_cents')?(Number(value)/100).toFixed(2):value instanceof Date?value.toISOString():typeof value==='object'?JSON.stringify(value):String(value).replace(/\s+/g,' ')})));
}
function parse(args){const o={},pos=[];for(let i=0;i<args.length;i++){const a=args[i];if(!a.startsWith('--')){pos.push(a);continue;}const [raw,...rest]=a.slice(2).split('=');const key=raw.replaceAll('-','_');if(Object.hasOwn(o,key))throw Error('Duplicate flag '+raw);if(['json','dry_run'].includes(key)){if(rest.length)throw Error('Boolean flag takes no value');o[key]=true;}else{o[key]=rest.length?rest.join('='):args[++i];if(o[key]===undefined||String(o[key]).startsWith('--'))throw Error('Missing flag value '+raw);}}return{o,pos};}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){let db;try{const {o,pos}=parse(process.argv.slice(2));const cmd=pos.shift()||'help';if(pos.length>(cmd==='import'?1:0))throw Error('Unexpected positional argument');db=await getDb();const rows=await run(db,cmd,o,pos);console.log(o.json?JSON.stringify(rows,null,2):format(rows));}catch(e){if(process.argv.includes('--json'))console.error(JSON.stringify({error:e.message}));else console.error(e.message);process.exitCode=1;}finally{if(db)await db.close();}}
