import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

type SbResult<T> = { data: T | null; error: { message: string } | null };

async function getOrg(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase
    .from('organizations')
    .select('id, organization_code, organization_name, timezone')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle() as unknown as SbResult<{
      id: string;
      organization_code: string;
      organization_name: string;
      timezone: string | null;
    }>;
  return data;
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const org = await getOrg(supabase);
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    return NextResponse.json({
      organization_code: org.organization_code,
      organization_name: org.organization_name,
      timezone: org.timezone ?? 'UTC',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { timezone?: string };
    const timezone = body.timezone?.trim();
    if (!timezone) return NextResponse.json({ error: 'timezone is required' }, { status: 400 });

    // Validate that the timezone is a valid IANA name
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch {
      return NextResponse.json({ error: `Invalid timezone: ${timezone}` }, { status: 400 });
    }

    const supabase = createAdminClient();
    const org = await getOrg(supabase);
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const { error } = await supabase
      .from('organizations')
      .update({ timezone, updated_at: new Date().toISOString() })
      .eq('id', org.id) as unknown as SbResult<null>;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, timezone });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
