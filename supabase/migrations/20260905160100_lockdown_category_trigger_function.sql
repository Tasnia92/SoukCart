-- Lock down the categories updated_at trigger function from direct RPC calls.
revoke execute on function public.set_categories_updated_at()
from public, anon, authenticated;
