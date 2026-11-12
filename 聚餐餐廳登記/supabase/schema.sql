-- =====================================================================
-- 聚餐餐廳選項登記表：Supabase 建表 SQL
-- 資料表：public.restaurant_options
--
-- 依據：聚餐餐廳登記/需求筆記.txt、聚餐餐廳登記/聚餐餐廳欄位表.xlsx
--
-- 誰能做什麼：
--   - 主辦人：在 Supabase 後台（Table Editor）新增、修改、刪除。
--     後台使用管理員身分連線，不受下面 anon 的限制。
--   - 一般同事（anon，未登入）：只能讀取清單，不能新增、修改、刪除。
--
-- 安全設計分三層：
--   1. GRANT：資料庫權限，anon 只有 SELECT。
--   2. RLS：資料列安全，只有讀取政策，沒有寫入政策。
--   3. CHECK：資料表限制，不管誰寫入（包含主辦人），欄位值都必須合法。
--
-- 只能使用 publishable key 存取；secret key 不可以寫進任何檔案。
-- 本檔案可重複執行：資料表已存在時不會重建，政策會先刪除再建立。
-- 執行方式：在 Supabase 專案的 SQL Editor 貼上後執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
-- 欄位對照（Excel 欄位名 → 資料表欄位）：
--   餐廳名稱 → name、地區或地址 → area_or_address、料理類型 → cuisine、
--   每人預算區間 → budget_range、可容納人數 → capacity、有無包廂 → has_private_room、
--   推薦人 → recommender、推薦理由 → reason、餐廳網址 → url、登記時間 → created_at
--
-- 必填規則在需求筆記中仍是「待確認」。這裡先暫定：
--   基本資料、預算與容量為必填（NOT NULL）；推薦資訊可以留空。
-- 文字欄位先用 btrim 去掉前後空白再計算長度，避免只填空白。
-- 字數上限、料理類型選項、預算區間、人數上限都是暫定值，確認後再調整。
create table if not exists public.restaurant_options (
    -- 主鍵：自動產生的 UUID。
    id               uuid        primary key default gen_random_uuid(),

    -- 登記時間：自動產生。
    created_at       timestamptz not null default now(),

    -- 餐廳名稱：必填，1～100 字。
    name             text        not null
        constraint restaurant_options_name_len
        check (char_length(btrim(name)) between 1 and 100),

    -- 地區或地址：必填，1～200 字。
    area_or_address  text        not null
        constraint restaurant_options_area_len
        check (char_length(btrim(area_or_address)) between 1 and 200),

    -- 料理類型：必填，只能是 中式、日式、西式、其他。
    cuisine          text        not null
        constraint restaurant_options_cuisine_values
        check (cuisine in ('中式', '日式', '西式', '其他')),

    -- 每人預算區間：必填，只能是三個區間之一。
    budget_range     text        not null
        constraint restaurant_options_budget_values
        check (budget_range in ('500 元以下', '500～1000 元', '1000 元以上')),

    -- 可容納人數：必填，1～1000 人。
    capacity         integer     not null
        constraint restaurant_options_capacity_range
        check (capacity between 1 and 1000),

    -- 有無包廂：必填，true 代表「有」，false 代表「無」，預設「無」。
    has_private_room boolean     not null default false,

    -- 推薦人：可留空；有填時 1～50 字。只填虛構姓名或部門代稱。
    recommender      text
        constraint restaurant_options_recommender_len
        check (recommender is null or char_length(btrim(recommender)) between 1 and 50),

    -- 推薦理由：可留空；有填時 1～500 字。
    reason           text
        constraint restaurant_options_reason_len
        check (reason is null or char_length(btrim(reason)) between 1 and 500),

    -- 餐廳網址：可留空；有填時必須是 http:// 或 https:// 開頭，最多 500 字，不能有空白。
    url              text
        constraint restaurant_options_url_format
        check (url is null or (url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 500))
);

-- 清單預設依登記時間由新到舊排序，加索引加快查詢。
create index if not exists restaurant_options_created_at_idx
    on public.restaurant_options (created_at desc);

-- 資料表與欄位說明，會顯示在 Supabase 的 Table Editor，方便主辦人對照。
comment on table  public.restaurant_options                  is '聚餐餐廳選項（示範用，主辦人在後台編輯，同事只能讀取）';
comment on column public.restaurant_options.id               is '主鍵，自動產生';
comment on column public.restaurant_options.created_at       is '登記時間，自動產生';
comment on column public.restaurant_options.name             is '餐廳名稱';
comment on column public.restaurant_options.area_or_address  is '地區或地址';
comment on column public.restaurant_options.cuisine          is '料理類型：中式、日式、西式、其他';
comment on column public.restaurant_options.budget_range     is '每人預算區間：500 元以下、500～1000 元、1000 元以上';
comment on column public.restaurant_options.capacity         is '可容納人數';
comment on column public.restaurant_options.has_private_room is '有無包廂：true＝有，false＝無';
comment on column public.restaurant_options.recommender      is '推薦人（虛構姓名或部門代稱）';
comment on column public.restaurant_options.reason           is '推薦理由';
comment on column public.restaurant_options.url              is '餐廳網址';


-- ---------------------------------------------------------------------
-- 二、GRANT 權限（第 1 層）
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，確保起點是「什麼都不能做」，
-- 也避免重複執行時留下以前給過的權限。
revoke all on table public.restaurant_options from public, anon, authenticated;

-- anon 需要能使用 public schema 才能存取裡面的資料表（Supabase 通常已經給過）。
grant usage on schema public to anon;

-- anon 只能讀取，用來讓同事查看清單。
grant select on table public.restaurant_options to anon;

-- 不給 anon 任何 INSERT、UPDATE、DELETE、TRUNCATE 權限：只有主辦人能從後台編輯。
-- 本次示範沒有登入功能，所以 authenticated 角色也不給任何權限。


-- ---------------------------------------------------------------------
-- 三、RLS 資料列安全（第 2 層）
-- ---------------------------------------------------------------------
-- 啟用資料列安全：啟用後，沒有政策允許的操作一律拒絕。
alter table public.restaurant_options enable row level security;

-- 先刪除舊政策，讓本檔案可以重複執行。
drop policy if exists "任何人可以讀取餐廳清單" on public.restaurant_options;

-- 讀取政策：anon 可以讀取所有資料列。
create policy "任何人可以讀取餐廳清單"
    on public.restaurant_options
    for select
    to anon
    using (true);

-- 不建立 INSERT、UPDATE、DELETE 政策：即使權限被誤開，RLS 仍會拒絕寫入。
-- 主辦人在 Supabase 後台編輯時使用管理員身分，不受 RLS 限制。
