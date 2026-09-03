-- Live sync can fetch several delivery streams before writing the batch.
-- The default pg_net timeout is too short and caused CoreFuel's request to
-- terminate before the endpoint completed. Preserve each existing job's URL,
-- headers and secret, changing only its HTTP timeout.
do $$
declare
  job record;
  updated_command text;
begin
  for job in
    select jobid, command
    from cron.job
    where jobname in ('live-fee-sync-0100', 'live-fee-sync-0600', 'live-fee-sync-15min')
  loop
    if job.command like '%timeout_milliseconds%' then
      continue;
    end if;

    -- Commands end in the outer net.http_post call's `);`. Keep everything
    -- before that closing delimiter exactly as-is (including secret headers).
    updated_command := rtrim(job.command, E' \t\n\r');
    if right(updated_command, 2) <> ');' then
      raise exception 'Unexpected live-sync cron command format for job %', job.jobid;
    end if;
    updated_command := left(updated_command, length(updated_command) - 2)
      || E',\n    timeout_milliseconds := 30000\n  );';
    perform cron.alter_job(job.jobid, null, updated_command, null, null, null);
  end loop;
end;
$$;
