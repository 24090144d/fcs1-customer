import Link from 'next/link';
import { Upload } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardHeaderActions } from '@/components/layout/DashboardHeaderActions';
import { DashboardClient } from './DashboardClient';
import type { ChainEntry } from '@/types/dashboard';
import { fetchDashboard, fetchCorpDashboard, fetchChainEntries, fetchCoIrRows, fetchCoRows } from '@/lib/dashboard-fetch';

export const dynamic = 'force-dynamic';

// Needed to allow searchParams without force-dynamic in static export
export const generateStaticParams = async () => [];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { hotel?: string; module?: string; chain?: string };
}) {
  const hotelCode = searchParams.hotel;
  const moduleCode = String(searchParams.module ?? '').toLowerCase();
  const isCorp = String(hotelCode ?? '').toLowerCase() === 'corp';
  const moduleBreadcrumb = moduleCode === 'co'
    ? 'CO ACSR Dashboard'
    : moduleCode === 'co-ir'
      ? 'CO Inspection Report Dashboard'
    : moduleCode === 'mo'
      ? 'MO Dashboard'
      : moduleCode === 'jo'
        ? 'JO Dashboard'
        : 'IM Dashboard';

  const corpPayload = isCorp
    ? await fetchCorpDashboard(searchParams.chain, searchParams.module)
    : { data: null, chainEntries: [] as ChainEntry[] };
  const data = isCorp ? corpPayload.data : await fetchDashboard(hotelCode, searchParams.module);

  if (!data) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Dashboard' }, { label: moduleBreadcrumb }]} headerRight={<DashboardHeaderActions />}>
        <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
          <div className="text-center space-y-4 px-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-200 flex items-center justify-center mx-auto">
              <Upload size={24} className="text-slate-500" />
            </div>
            <h1 className="font-serif text-2xl font-bold text-slate-800">No Dashboard Data</h1>
            <p className="font-sans text-sm text-slate-500 max-w-sm">
              Upload an IM, JO, MO, CO ACSR, or CO Inspection Report CSV file to generate your dashboard. The analysis will appear here automatically after finalization.
            </p>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 bg-slate-800 text-white font-sans text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-slate-700 transition-colors"
            >
              <Upload size={15} />
              Upload CSV
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const chainEntries = isCorp
    ? corpPayload.chainEntries
    : data.meta.chain_code
    ? await fetchChainEntries(data.meta.chain_code, data.meta.hotel_code, searchParams.module)
    : [];
  const coRows = moduleCode === 'co'
    ? await fetchCoRows(data.meta.hotel_code, data.meta.chain_code)
    : [];
  const coIrRows = moduleCode === 'co-ir'
    ? await fetchCoIrRows(data.meta.hotel_code, data.meta.chain_code)
    : [];

  const { chain_code, hotel_code, hotel_name, country_code } = data.meta;
  const hotelLabel = hotel_code
    ? [chain_code, hotel_code, hotel_name, country_code ? `(${country_code})` : '']
        .filter(Boolean).join(' - ')
    : data.meta.source_name;

  return (
    <AppLayout breadcrumbs={[{ label: 'Dashboard' }, { label: moduleBreadcrumb }, { label: hotelLabel }]} headerRight={<DashboardHeaderActions />}>
      <DashboardClient data={data} chainEntries={chainEntries} coRows={coRows} coIrRows={coIrRows} />
    </AppLayout>
  );
}
