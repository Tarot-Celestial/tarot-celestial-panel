-- Allow independent client purchases while retaining all existing orders.
-- Primary key, public token, provider order and capture uniqueness stay enforced.
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS public.crm_paypal_orders_one_client_pending;
