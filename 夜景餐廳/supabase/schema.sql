-- =====================================================================
-- 夜景餐廳口袋名單：Supabase 建表 SQL
-- 資料表：public.night_view_restaurants
--
-- 依據：夜景餐廳/需求筆記.txt
--
-- 這是個人專用清單：
--   - 只有登入的帳號（authenticated）能存取，未登入的 anon 什麼都不能做。
--   - 每一筆資料都有擁有者（owner_id），只有擁有者本人能讀取、新增、修改、刪除。
--   - 請另外在 Supabase 的 Authentication 設定關閉自行註冊，只保留自己的帳號。
--
-- 安全設計分三層：
--   1. GRANT：資料庫權限，anon 沒有任何權限；authenticated 只能寫入允許的欄位。
--   2. RLS：資料列安全，每個操作都限制 owner_id = auth.uid()。
--   3. CHECK：資料表限制，欄位值與長度必須合法。
--
-- 只能使用 publishable key 存取；secret key 不可以寫進任何檔案。
-- 本檔案可重複執行：資料表已存在時不會重建，政策與觸發器會先刪除再建立。
-- 執行方式：在 Supabase 專案的 SQL Editor 貼上後執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、建立資料表與 CHECK 限制（第 3 層）
-- ---------------------------------------------------------------------
-- 必填欄位暫定為：餐廳名稱、城市或地區、夜景類型（需求筆記未定，待確認）。
-- 夜景類型、價位區間的選項都是暫定值，確認後再調整。
-- 文字欄位先用 btrim 去掉前後空白再計算長度，避免只填空白。
create table if not exists public.night_view_restaurants (
    -- 主鍵：自動產生。
    id              uuid        primary key default gen_random_uuid(),

    -- 擁有者：自動帶入目前登入的帳號；帳號刪除時一併刪除資料。
    owner_id        uuid        not null default auth.uid()
                                references auth.users (id) on delete cascade,

    -- 登記時間、最後修改時間：自動產生。
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- 基本與地點 -------------------------------------------------------
    -- 餐廳名稱：必填，1～100 字。
    name            text        not null
        constraint nvr_name_len check (char_length(btrim(name)) between 1 and 100),

    -- 城市或地區：必填，1～50 字。
    city            text        not null
        constraint nvr_city_len check (char_length(btrim(city)) between 1 and 50),

    -- 地址：可留空，最多 200 字。
    address         text
        constraint nvr_address_len check (address is null or char_length(btrim(address)) between 1 and 200),

    -- 餐廳網址：可留空；必須是 http:// 或 https:// 開頭，不能有空白，最多 500 字。
    url             text
        constraint nvr_url_format check (url is null or (url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 500)),

    -- 夜景特色 ---------------------------------------------------------
    -- 夜景類型：必填，只能是 城市夜景、海景、山景、河景、其他。
    view_type       text        not null
        constraint nvr_view_type_values check (view_type in ('城市夜景', '海景', '山景', '河景', '其他')),

    -- 樓層或高度：可留空，最多 50 字（填寫格式待確認，例如「38 樓」「山上」）。
    floor_or_height text
        constraint nvr_floor_len check (floor_or_height is null or char_length(btrim(floor_or_height)) between 1 and 50),

    -- 靠窗座位好不好訂：可留空；只能是 容易、普通、困難。
    window_seat     text
        constraint nvr_window_seat_values check (window_seat is null or window_seat in ('容易', '普通', '困難')),

    -- 價位與訂位 -------------------------------------------------------
    -- 每人價位區間：可留空；暫定以新台幣分三級（幣別待確認）。
    price_range     text
        constraint nvr_price_values check (price_range is null or price_range in ('1000 元以下', '1000～2000 元', '2000 元以上')),

    -- 是否需要訂位：可留空；只能是 需要、建議、不用。
    reservation     text
        constraint nvr_reservation_values check (reservation is null or reservation in ('需要', '建議', '不用')),

    -- 營業時間：可留空，最多 100 字。
    opening_hours   text
        constraint nvr_hours_len check (opening_hours is null or char_length(btrim(opening_hours)) between 1 and 100),

    -- 評價與推薦 -------------------------------------------------------
    -- 評分：可留空（還沒去過）；有填時 1～5 分。
    rating          smallint
        constraint nvr_rating_range check (rating is null or rating between 1 and 5),

    -- 推薦理由：可留空，最多 500 字。
    reason          text
        constraint nvr_reason_len check (reason is null or char_length(btrim(reason)) between 1 and 500),

    -- 推薦人：可留空，最多 50 字。只填虛構代稱，例如「朋友 A」「旅遊書」。
    recommender     text
        constraint nvr_recommender_len check (recommender is null or char_length(btrim(recommender)) between 1 and 50),

    -- 去過的日期：可留空（代表還沒去過）。
    visited_on      date
);

-- 依擁有者與登記時間查詢清單，加索引加快速度。
create index if not exists nvr_owner_created_idx
    on public.night_view_restaurants (owner_id, created_at desc);

-- 資料表與欄位說明，會顯示在 Supabase 的 Table Editor。
comment on table  public.night_view_restaurants                 is '夜景餐廳口袋名單（個人專用，只有擁有者能存取）';
comment on column public.night_view_restaurants.owner_id        is '擁有者，自動帶入登入帳號';
comment on column public.night_view_restaurants.created_at      is '登記時間，自動產生';
comment on column public.night_view_restaurants.updated_at      is '最後修改時間，自動更新';
comment on column public.night_view_restaurants.name            is '餐廳名稱';
comment on column public.night_view_restaurants.city            is '城市或地區';
comment on column public.night_view_restaurants.address         is '地址';
comment on column public.night_view_restaurants.url             is '餐廳網址';
comment on column public.night_view_restaurants.view_type       is '夜景類型：城市夜景、海景、山景、河景、其他';
comment on column public.night_view_restaurants.floor_or_height is '樓層或高度';
comment on column public.night_view_restaurants.window_seat     is '靠窗座位好不好訂：容易、普通、困難';
comment on column public.night_view_restaurants.price_range     is '每人價位區間：1000 元以下、1000～2000 元、2000 元以上';
comment on column public.night_view_restaurants.reservation     is '是否需要訂位：需要、建議、不用';
comment on column public.night_view_restaurants.opening_hours   is '營業時間';
comment on column public.night_view_restaurants.rating          is '評分 1～5，未去過可留空';
comment on column public.night_view_restaurants.reason          is '推薦理由';
comment on column public.night_view_restaurants.recommender     is '推薦人（虛構代稱）';
comment on column public.night_view_restaurants.visited_on      is '去過的日期，未去過留空';


-- ---------------------------------------------------------------------
-- 二、自動更新「最後修改時間」
-- ---------------------------------------------------------------------
-- 每次修改資料時，由資料庫把 updated_at 設為現在時間，網頁不能自行指定。
create or replace function public.nvr_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists nvr_set_updated_at on public.night_view_restaurants;
create trigger nvr_set_updated_at
    before update on public.night_view_restaurants
    for each row execute function public.nvr_set_updated_at();


-- ---------------------------------------------------------------------
-- 三、GRANT 權限（第 1 層）
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，確保起點是「什麼都不能做」。
revoke all on table public.night_view_restaurants from public, anon, authenticated;

-- anon（未登入）不給任何權限。

-- authenticated（已登入）需要使用 public schema。
grant usage on schema public to authenticated;

-- 已登入的帳號可以讀取與刪除（實際只限自己的資料，見 RLS）。
grant select, delete on table public.night_view_restaurants to authenticated;

-- 新增與修改只能寫入下列內容欄位。
-- id、owner_id、created_at、updated_at 不在清單內，由資料庫自動產生，網頁不能指定。
grant insert (name, city, address, url, view_type, floor_or_height, window_seat,
              price_range, reservation, opening_hours, rating, reason, recommender, visited_on)
    on table public.night_view_restaurants to authenticated;
grant update (name, city, address, url, view_type, floor_or_height, window_seat,
              price_range, reservation, opening_hours, rating, reason, recommender, visited_on)
    on table public.night_view_restaurants to authenticated;


-- ---------------------------------------------------------------------
-- 四、RLS 資料列安全（第 2 層）
-- ---------------------------------------------------------------------
-- 啟用資料列安全：啟用後，沒有政策允許的操作一律拒絕。
alter table public.night_view_restaurants enable row level security;

-- 先刪除舊政策，讓本檔案可以重複執行。
drop policy if exists "只有擁有者可以讀取" on public.night_view_restaurants;
drop policy if exists "只有擁有者可以新增" on public.night_view_restaurants;
drop policy if exists "只有擁有者可以修改" on public.night_view_restaurants;
drop policy if exists "只有擁有者可以刪除" on public.night_view_restaurants;

-- 讀取：只看得到自己的資料。
create policy "只有擁有者可以讀取"
    on public.night_view_restaurants
    for select
    to authenticated
    using (owner_id = (select auth.uid()));

-- 新增：新資料的擁有者必須是自己。
create policy "只有擁有者可以新增"
    on public.night_view_restaurants
    for insert
    to authenticated
    with check (owner_id = (select auth.uid()));

-- 修改：只能改自己的資料，改完仍必須是自己的。
create policy "只有擁有者可以修改"
    on public.night_view_restaurants
    for update
    to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

-- 刪除：只能刪自己的資料。
create policy "只有擁有者可以刪除"
    on public.night_view_restaurants
    for delete
    to authenticated
    using (owner_id = (select auth.uid()));

-- anon 沒有任何政策：即使權限被誤開，RLS 仍會拒絕未登入的存取。
