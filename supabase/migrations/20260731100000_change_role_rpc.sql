-- Server-side role change: prevents client-side direct manipulation of user_roles.
-- Only admins can call this (checked via auth.uid() role lookup).

create or replace function change_user_role(target_uid uuid, new_role text)
returns void language plpgsql security definer as $$
declare
  caller_role text;
begin
  select role into caller_role from user_roles where user_id = auth.uid();
  if caller_role is distinct from 'admin' then
    raise exception 'Only admins can change roles';
  end if;
  if new_role not in ('admin', 'rider') then
    raise exception 'Invalid role: %', new_role;
  end if;
  if target_uid = auth.uid() then
    raise exception 'Cannot change your own role';
  end if;

  delete from user_roles where user_id = target_uid;
  insert into user_roles (user_id, role) values (target_uid, new_role);
end $$;
