-- =====================================================================
-- 公司附近午餐美食圖：Supabase 建表 SQL
-- 資料表：public.lunch_profiles（暱稱）、public.lunch_restaurants（店家）、public.lunch_ratings（評價）
--
-- 依據：美食圖/需求筆記.txt、美食圖/AGENTS.md
--
-- 權限原則（需求筆記未定的部分採最保守做法）：
--   - 未登入的 anon：所有資料表都沒有任何權限。
--   - 登入的同事（authenticated）：
--       讀取：全部店家、全部評價、全部暱稱。
--       新增：店家（新增者自動是本人）、評價（評分者自動是本人，一人一家店只能一筆）。
--       暱稱：只能建立與修改自己的暱稱。
--       修改／刪除自己的店家與評價：需求筆記「待確認」，目前不開放。
--   - 管理者：在 Supabase 後台（Table Editor）刪除不適合或重複的店家與評價。
--   - 畫面上不顯示 Email：auth.users 不開放讀取，改顯示 lunch_profiles 的暱稱。
--
-- 另外請在 Supabase 的 Authentication 設定關閉自行註冊（Allow new users to sign up），
-- 由管理者在 Users 建立同事帳號；否則任何人都能註冊後讀取資料。
--
-- 安全設計分三層：GRANT（資料庫權限）、RLS（資料列安全）、CHECK（欄位限制）。
-- 只能使用 publishable key 存取；secret key 不可以寫進任何檔案。
-- 本檔案可重複執行。執行方式：在 Supabase 專案的 SQL Editor 貼上後執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 一、暱稱 lunch_profiles
-- ---------------------------------------------------------------------
-- 每個帳號一筆，id 就是登入帳號的 id。畫面上用暱稱代替 Email。
create table if not exists public.lunch_profiles (
    id          uuid        primary key default auth.uid()
                            references auth.users (id) on delete cascade,
    nickname    text        not null
        constraint lunch_profiles_nickname_len check (char_length(btrim(nickname)) between 1 and 20),
    created_at  timestamptz not null default now()
);
comment on table  public.lunch_profiles          is '美食圖暱稱（畫面上代替 Email 顯示）';
comment on column public.lunch_profiles.nickname is '暱稱，1～20 字，請用代稱，不要用真實姓名';


-- ---------------------------------------------------------------------
-- 二、店家 lunch_restaurants（CHECK 限制）
-- ---------------------------------------------------------------------
-- 必填暫定：店名、料理類型、地圖位置（美食圖以地圖為主）。其餘可留空。
-- 料理類型、價位區間、步行分鐘上限都是暫定值（需求筆記待確認）。
create table if not exists public.lunch_restaurants (
    id               uuid        primary key default gen_random_uuid(),

    -- 新增者：自動帶入目前登入的帳號；帳號刪除時保留店家，新增者改為空白。
    created_by       uuid        default auth.uid()
                                 references auth.users (id) on delete set null,
    created_at       timestamptz not null default now(),

    -- 基本與位置
    name             text        not null
        constraint lunch_rest_name_len check (char_length(btrim(name)) between 1 and 100),
    address          text
        constraint lunch_rest_address_len check (address is null or char_length(btrim(address)) between 1 and 200),
    latitude         double precision not null
        constraint lunch_rest_lat_range check (latitude between -90 and 90),
    longitude        double precision not null
        constraint lunch_rest_lon_range check (longitude between -180 and 180),
    walk_minutes     smallint
        constraint lunch_rest_walk_range check (walk_minutes is null or walk_minutes between 1 and 60),

    -- 吃什麼與價位
    cuisine          text        not null
        constraint lunch_rest_cuisine_values check (cuisine in ('便當', '麵食', '飯類', '輕食', '異國料理', '其他')),
    price_range      text
        constraint lunch_rest_price_values check (price_range is null or price_range in ('100 元以下', '100～200 元', '200 元以上')),
    signature_dishes text
        constraint lunch_rest_dishes_len check (signature_dishes is null or char_length(btrim(signature_dishes)) between 1 and 200),

    -- 營業與用餐方式
    opening_hours    text
        constraint lunch_rest_hours_len check (opening_hours is null or char_length(btrim(opening_hours)) between 1 and 100),
    dining_mode      text
        constraint lunch_rest_mode_values check (dining_mode is null or dining_mode in ('內用', '外帶', '皆可')),
    delivery         boolean
);
create index if not exists lunch_rest_created_idx on public.lunch_restaurants (created_at desc);

comment on table  public.lunch_restaurants                  is '美食圖店家（登入的同事可新增；修改與刪除由管理者在後台操作）';
comment on column public.lunch_restaurants.created_by       is '新增者（登入帳號，自動帶入）';
comment on column public.lunch_restaurants.name             is '店名';
comment on column public.lunch_restaurants.address          is '地址';
comment on column public.lunch_restaurants.latitude         is '緯度';
comment on column public.lunch_restaurants.longitude        is '經度';
comment on column public.lunch_restaurants.walk_minutes     is '從公司步行幾分鐘（1～60）';
comment on column public.lunch_restaurants.cuisine          is '料理類型：便當、麵食、飯類、輕食、異國料理、其他';
comment on column public.lunch_restaurants.price_range      is '價位區間：100 元以下、100～200 元、200 元以上';
comment on column public.lunch_restaurants.signature_dishes is '推薦菜色';
comment on column public.lunch_restaurants.opening_hours    is '營業時間';
comment on column public.lunch_restaurants.dining_mode      is '用餐方式：內用、外帶、皆可';
comment on column public.lunch_restaurants.delivery         is '可否外送：true＝可以，false＝不行';


-- ---------------------------------------------------------------------
-- 三、評價 lunch_ratings（CHECK 與唯一限制）
-- ---------------------------------------------------------------------
-- 一位同事對同一家店只能有一筆評價：由唯一限制保證，不只靠網頁檢查。
-- 店家被刪除時，評價一併刪除。
create table if not exists public.lunch_ratings (
    id             uuid        primary key default gen_random_uuid(),
    restaurant_id  uuid        not null references public.lunch_restaurants (id) on delete cascade,
    user_id        uuid        not null default auth.uid()
                               references auth.users (id) on delete cascade,
    score          smallint    not null
        constraint lunch_ratings_score_range check (score between 1 and 5),
    comment        text
        constraint lunch_ratings_comment_len check (comment is null or char_length(btrim(comment)) between 1 and 200),
    created_at     timestamptz not null default now(),
    constraint lunch_ratings_one_per_user unique (restaurant_id, user_id)
);
create index if not exists lunch_ratings_restaurant_idx on public.lunch_ratings (restaurant_id);

comment on table  public.lunch_ratings         is '美食圖評價（一人一家店一筆）';
comment on column public.lunch_ratings.user_id is '評分者（登入帳號，自動帶入）';
comment on column public.lunch_ratings.score   is '評分 1～5';
comment on column public.lunch_ratings.comment is '短評，最多 200 字';


-- ---------------------------------------------------------------------
-- 四、GRANT 權限（第 1 層）
-- ---------------------------------------------------------------------
-- 先收回所有角色的全部權限，確保起點是「什麼都不能做」。anon 之後不再給任何權限。
revoke all on table public.lunch_profiles    from public, anon, authenticated;
revoke all on table public.lunch_restaurants from public, anon, authenticated;
revoke all on table public.lunch_ratings     from public, anon, authenticated;

grant usage on schema public to authenticated;

-- 登入的同事可以讀取三張表。
grant select on table public.lunch_profiles, public.lunch_restaurants, public.lunch_ratings to authenticated;

-- 暱稱：只能寫入 nickname（id 自動是本人）。
grant insert (nickname) on table public.lunch_profiles to authenticated;
grant update (nickname) on table public.lunch_profiles to authenticated;

-- 店家：只能寫入內容欄位（id、created_by、created_at 由資料庫產生）。不給 UPDATE、DELETE。
grant insert (name, address, latitude, longitude, walk_minutes, cuisine, price_range,
              signature_dishes, opening_hours, dining_mode, delivery)
    on table public.lunch_restaurants to authenticated;

-- 評價：只能寫入店家、分數、短評（user_id、created_at 由資料庫產生）。不給 UPDATE、DELETE。
grant insert (restaurant_id, score, comment) on table public.lunch_ratings to authenticated;


-- ---------------------------------------------------------------------
-- 五、RLS 資料列安全（第 2 層）
-- ---------------------------------------------------------------------
alter table public.lunch_profiles    enable row level security;
alter table public.lunch_restaurants enable row level security;
alter table public.lunch_ratings     enable row level security;

drop policy if exists "登入的同事可以讀取暱稱" on public.lunch_profiles;
drop policy if exists "只能建立自己的暱稱"     on public.lunch_profiles;
drop policy if exists "只能修改自己的暱稱"     on public.lunch_profiles;
drop policy if exists "登入的同事可以讀取店家" on public.lunch_restaurants;
drop policy if exists "新增店家時新增者必須是本人" on public.lunch_restaurants;
drop policy if exists "登入的同事可以讀取評價" on public.lunch_ratings;
drop policy if exists "評分者必須是本人"       on public.lunch_ratings;

-- 暱稱
create policy "登入的同事可以讀取暱稱"
    on public.lunch_profiles for select to authenticated
    using (true);
create policy "只能建立自己的暱稱"
    on public.lunch_profiles for insert to authenticated
    with check (id = (select auth.uid()));
create policy "只能修改自己的暱稱"
    on public.lunch_profiles for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- 店家
create policy "登入的同事可以讀取店家"
    on public.lunch_restaurants for select to authenticated
    using (true);
create policy "新增店家時新增者必須是本人"
    on public.lunch_restaurants for insert to authenticated
    with check (created_by = (select auth.uid()));

-- 評價
create policy "登入的同事可以讀取評價"
    on public.lunch_ratings for select to authenticated
    using (true);
create policy "評分者必須是本人"
    on public.lunch_ratings for insert to authenticated
    with check (user_id = (select auth.uid()));

-- 沒有任何 anon 政策，也沒有 UPDATE（暱稱除外）、DELETE 政策：
-- 即使權限被誤開，RLS 仍會拒絕未登入的存取與修改、刪除。
