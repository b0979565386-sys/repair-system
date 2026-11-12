-- =====================================================================
-- 報修登記系統：Supabase 建表 SQL
-- 資料表：public.repair_requests
--
-- 安全設計分三層，缺一層也不會直接失守：
--   1. GRANT：資料庫權限，決定 anon 角色能對哪些欄位做哪些操作。
--   2. RLS：資料列安全，決定 anon 能讀、能新增哪些資料列。
--   3. CHECK：資料表限制，不管誰寫入，欄位值與長度都必須合法。
--
-- 本檔案可重複執行：資料表已存在時不會重建，政策會先刪除再建立。
-- 執行方式：在 Supabase 專案的 SQL Editor 貼上後執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
-- 所有欄位都不允許空值（NOT NULL）。
-- 文字欄位先用 btrim 去掉前後空白再計算長度，避免只填空白就送出。
-- 長度上限：姓名 50 字、地點或部門 100 字、問題說明 1000 字。
-- 選項欄位只接受需求筆記列出的值。
create table if not exists public.repair_requests (
    -- 主鍵：由資料庫自動產生的 UUID，前端不能指定。
    id            uuid        primary key default gen_random_uuid(),

    -- 建立時間（登記時間）：由資料庫自動產生，前端不能指定。
    created_at    timestamptz not null default now(),

    -- 報修人姓名：1～50 字。
    reporter_name text        not null
        constraint repair_requests_reporter_name_len
        check (char_length(btrim(reporter_name)) between 1 and 50),

    -- 地點或部門：1～100 字。
    location      text        not null
        constraint repair_requests_location_len
        check (char_length(btrim(location)) between 1 and 100),

    -- 類別：只能是 設備、網路、環境、其他。
    category      text        not null
        constraint repair_requests_category_values
        check (category in ('設備', '網路', '環境', '其他')),

    -- 問題說明：1～1000 字。
    description   text        not null
        constraint repair_requests_description_len
        check (char_length(btrim(description)) between 1 and 1000),

    -- 緊急程度：只能是 低、中、高，預設「中」。
    urgency       text        not null default '中'
        constraint repair_requests_urgency_values
        check (urgency in ('低', '中', '高')),

    -- 處理狀態：只能是 待處理、處理中、已完成，預設「待處理」。
    status        text        not null default '待處理'
        constraint repair_requests_status_values
        check (status in ('待處理', '處理中', '已完成'))
);

-- 清單通常依登記時間由新到舊排序，加索引加快查詢。
create index if not exists repair_requests_created_at_idx
    on public.repair_requests (created_at desc);

-- 資料表與欄位說明，會顯示在 Supabase 的 Table Editor。
comment on table  public.repair_requests               is '報修登記資料（示範用，只能新增與讀取）';
comment on column public.repair_requests.id            is '主鍵，自動產生';
comment on column public.repair_requests.created_at    is '登記時間，自動產生';
comment on column public.repair_requests.reporter_name is '報修人姓名';
comment on column public.repair_requests.location      is '地點或部門';
comment on column public.repair_requests.category      is '類別：設備、網路、環境、其他';
comment on column public.repair_requests.description   is '問題說明';
comment on column public.repair_requests.urgency       is '緊急程度：低、中、高';
comment on column public.repair_requests.status        is '處理狀態：待處理、處理中、已完成';


-- ---------------------------------------------------------------------
-- 二、GRANT 權限（第 1 層）
-- ---------------------------------------------------------------------
-- 這個 Supabase 專案不會自動開放新資料表，所以要明確授權。
-- 先收回所有角色的全部權限，確保起點是「什麼都不能做」，
-- 也避免重複執行時留下以前給過的權限。
revoke all on table public.repair_requests from public, anon, authenticated;

-- anon 需要能使用 public schema 才能存取裡面的資料表（Supabase 通常已經給過）。
grant usage on schema public to anon;

-- anon 可以讀取全部欄位，用來顯示清單。
grant select on table public.repair_requests to anon;

-- anon 只能新增這五個欄位。
-- id、created_at、status 不在清單內：前端若嘗試寫入這三個欄位，資料庫會直接拒絕，
-- 這三個欄位一律使用預設值。
grant insert (reporter_name, location, category, description, urgency)
    on table public.repair_requests to anon;

-- 不給 anon 任何 UPDATE、DELETE、TRUNCATE 權限（上面的 revoke 已全部收回）。
-- 本次示範沒有登入功能，所以 authenticated 角色也不給任何權限。


-- ---------------------------------------------------------------------
-- 三、RLS 資料列安全（第 2 層）
-- ---------------------------------------------------------------------
-- 啟用資料列安全：啟用後，沒有政策允許的操作一律拒絕。
alter table public.repair_requests enable row level security;

-- 先刪除舊政策，讓本檔案可以重複執行。
drop policy if exists "任何人可以讀取報修清單" on public.repair_requests;
drop policy if exists "任何人可以新增待處理的報修" on public.repair_requests;

-- 讀取政策：anon 可以讀取所有資料列。
create policy "任何人可以讀取報修清單"
    on public.repair_requests
    for select
    to anon
    using (true);

-- 新增政策：anon 可以新增，但新資料的 status 必須是「待處理」。
-- GRANT 已經禁止 anon 寫入 status，這裡再檢查一次，作為第二道防線。
create policy "任何人可以新增待處理的報修"
    on public.repair_requests
    for insert
    to anon
    with check (status = '待處理');

-- 不建立 UPDATE、DELETE 政策：即使權限被誤開，RLS 仍會拒絕修改與刪除。
