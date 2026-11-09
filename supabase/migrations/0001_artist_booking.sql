create table artists (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), owner text not null default '', retention_review date, notes text not null default '');
create table promoters (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), contact text not null default '', email text not null default '', retention_review date, notes text not null default '');
create table venues (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), city text not null default '', timezone text not null default 'Pacific/Auckland', address text not null default '', emergency_contact text not null default '', notes text not null default '');
create table bookings (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), artist_id uuid not null references artists, promoter_id uuid not null references promoters, venue_id uuid not null references venues,
 starts_at timestamptz not null, ends_at timestamptz not null, hold_until date,
 status text not null default 'hold' check(status in ('hold','confirmed','completed','cancelled')),
 currency text not null default 'NZD' check(currency ~ '^[A-Z]{3}$'), fee_cents bigint not null default 0 check(fee_cents between 0 and 900000000000),
 deposit_cents bigint not null default 0 check(deposit_cents between 0 and 900000000000), deposit_due date,
 contract_ref text not null default '', contract_on date, contract_actor text not null default '',
 owner text not null default '', notes text not null default '', source_status text not null default '', source_row jsonb,
 check(ends_at>starts_at), check(deposit_cents<=fee_cents), check(deposit_cents=0 or deposit_due is not null));
create table advance_items (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), booking_id uuid not null references bookings, category text not null check(category in ('technical','hospitality','safety','access','other')),
 due_on date not null, owner text not null default '', notes text not null default '', completed_on date, evidence_ref text not null default '', completed_by text not null default '',
 check(completed_on is null or (length(trim(evidence_ref))>0 and length(trim(completed_by))>0)));
create table journeys (id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]*$'), name text not null check(length(trim(name))>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), booking_id uuid not null references bookings, departs_at timestamptz not null, arrives_at timestamptz not null,
 origin text not null, destination text not null, reference text not null default '', notes text not null default '', check(arrives_at>departs_at));
create table receipts (id uuid primary key default gen_random_uuid(), booking_id uuid not null references bookings, reference text not null unique,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=900000000000), received_on date not null, actor text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table activity (id uuid primary key default gen_random_uuid(), entity text not null, record_id uuid not null, actor text not null, action text not null, note text not null default '', before_row jsonb, after_row jsonb, created_at timestamptz not null default now());
create function touch_updated() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp();return new;end $$;
create trigger artists_updated before update on artists for each row execute function touch_updated();
create trigger promoters_updated before update on promoters for each row execute function touch_updated();
create trigger venues_updated before update on venues for each row execute function touch_updated();
create trigger bookings_updated before update on bookings for each row execute function touch_updated();
create trigger advance_items_updated before update on advance_items for each row execute function touch_updated();
create trigger journeys_updated before update on journeys for each row execute function touch_updated();
create trigger receipts_updated before update on receipts for each row execute function touch_updated();
alter table artists enable row level security; revoke all on artists from public;
alter table promoters enable row level security; revoke all on promoters from public;
alter table venues enable row level security; revoke all on venues from public;
alter table bookings enable row level security; revoke all on bookings from public;
alter table advance_items enable row level security; revoke all on advance_items from public;
alter table journeys enable row level security; revoke all on journeys from public;
alter table receipts enable row level security; revoke all on receipts from public;
alter table activity enable row level security; revoke all on activity from public;

create index bookings_artist_dates on bookings(artist_id,starts_at,ends_at);
create index advance_booking on advance_items(booking_id);
create index journeys_booking on journeys(booking_id);
create index receipts_booking on receipts(booking_id);
create view booking_desk as
select b.*, a.name artist, p.name promoter, v.name venue, v.city, v.timezone,
 to_char(b.starts_at at time zone v.timezone,'YYYY-MM-DD HH24:MI') local_start,
 to_char(b.ends_at at time zone v.timezone,'YYYY-MM-DD HH24:MI') local_end,
 coalesce((select sum(r.amount_cents) from receipts r where r.booking_id=b.id),0)::bigint received_cents,
 greatest(b.deposit_cents-coalesce((select sum(r.amount_cents) from receipts r where r.booking_id=b.id),0),0)::bigint deposit_outstanding_cents,
 b.fee_cents-coalesce((select sum(r.amount_cents) from receipts r where r.booking_id=b.id),0)::bigint balance_cents,
 (select count(*) from advance_items x where x.booking_id=b.id and x.completed_on is null)::integer open_advance,
 exists(select 1 from advance_items x where x.booking_id=b.id and x.category='safety' and x.completed_on is not null) safety_reviewed
from bookings b join artists a on a.id=b.artist_id join promoters p on p.id=b.promoter_id join venues v on v.id=b.venue_id;
create view booking_clashes as
select a.code booking,b.code conflicts_with,ar.name artist,a.starts_at,b.ends_at
from bookings a join bookings b on a.artist_id=b.artist_id and a.id::text<b.id::text and a.starts_at<b.ends_at and b.starts_at<a.ends_at
join artists ar on ar.id=a.artist_id where a.status in ('hold','confirmed') and b.status in ('hold','confirmed');
create view preparation_queue as
select x.id,x.code,x.name,x.category,b.code booking,b.artist,b.local_start,x.due_on,x.owner,x.completed_on,x.evidence_ref
from advance_items x join booking_desk b on b.id=x.booking_id where b.status in ('hold','confirmed');
create view findings as
select 'HOLD-EXPIRED' rule,code record,'Resolve the expired hold' issue,owner from bookings where status='hold' and (hold_until is null or hold_until<current_date)
union all select 'CONTRACT-MISSING',code,'Confirmed show lacks a signed contract reference',owner from bookings where status='confirmed' and (contract_on is null or contract_ref='' or contract_actor='')
union all select 'DEPOSIT-OVERDUE',code,'Agreed deposit remains outstanding',owner from booking_desk where status in ('hold','confirmed') and deposit_due<current_date and deposit_outstanding_cents>0
union all select 'ADVANCE-OVERDUE',x.code,'Outstanding '||x.category||' preparation for '||b.code,x.owner from advance_items x join bookings b on b.id=x.booking_id where b.status in ('hold','confirmed') and x.completed_on is null and x.due_on<current_date
union all select 'SAFETY-REVIEW',code,'No completed safety coordination record',owner from booking_desk where status='confirmed' and starts_at<current_timestamp+interval '14 days' and not safety_reviewed
union all select 'BOOKING-CLASH',booking,'Overlaps '||conflicts_with,'' from booking_clashes
union all select 'TRAVEL-LATE',j.code,'Arrival is after the show starts','' from journeys j join bookings b on b.id=j.booking_id where b.status in ('hold','confirmed') and j.arrives_at>b.starts_at
union all select 'PRIVACY-REVIEW',code,'Review retention purpose for artist contact',owner from artists where retention_review is null or retention_review<current_date
union all select 'PRIVACY-REVIEW',code,'Review retention purpose for promoter contact','' from promoters where retention_review is null or retention_review<current_date;
revoke all on booking_desk,booking_clashes,preparation_queue,findings from public;
