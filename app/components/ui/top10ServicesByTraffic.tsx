import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface Top10ServicesProps {
  data: any[];
  serviceIdList?: any[];
}

type TrafficType = 'total' | 'clean' | 'bot';

export default function Top10ServicesByTraffic({
  data,
  serviceIdList,
}: Top10ServicesProps) {
  const [trafficType, setTrafficType] = useState<TrafficType>('total');

  /* ---------------- NORMALIZE SERVICE LIST ---------------- */
  const serviceNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (serviceIdList || []).forEach((s: any) => {
      const id = String(s.serviceId ?? s.id ?? s.service_id).trim();
      const name =
        s.serviceIdName ??
        s.name ??
        s.service_name ??
        s.serviceName;

      if (id && name) map[id] = String(name).trim();
    });
    return map;
  }, [serviceIdList]);

  /* ---------------- HELPERS ---------------- */
  const parseMaybe = (val: any) => {
    if (!val) return {};
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    }
    return val;
  };

  const normalizeValue = (v: any) =>
    typeof v === 'object' && v !== null
      ? v.total ?? v.count ?? v.value ?? 0
      : Number(v) || 0;

  

  const getServiceTraffic = (record: any, serviceId: string) => {
    const total = parseMaybe(record.service_wise_total_traffic)?.[serviceId];
    const clean = parseMaybe(record.service_wise_clean_traffic)?.[serviceId];
    const bot = parseMaybe(record.service_wise_bot_traffic)?.[serviceId];

    return {
      total: normalizeValue(total),
      clean: normalizeValue(clean),
      bot: normalizeValue(bot),
    };
  };

  /* ---------------- BUILD TOP-10 DATA ---------------- */
  const top10Data = useMemo(() => {
    const map: Record<string, number> = {};

    data.forEach((record) => {
      const ids = new Set([
        ...Object.keys(parseMaybe(record.service_wise_total_traffic)),
        ...Object.keys(parseMaybe(record.service_wise_clean_traffic)),
        ...Object.keys(parseMaybe(record.service_wise_bot_traffic)),
      ]);

      ids.forEach((rawId) => {
        const serviceId = String(rawId).trim();
        const { total, clean, bot } = getServiceTraffic(record, serviceId);

        const value =
          trafficType === 'clean'
            ? clean
            : trafficType === 'bot'
            ? bot
            : total;

        map[serviceId] = (map[serviceId] || 0) + value;
      });
    });

    return Object.entries(map)
  .map(([serviceId, totalTraffic]) => {
    const fullName = serviceNameMap[serviceId] ?? `Service ${serviceId}`;

    return {
      serviceId,
      totalTraffic,
      fullServiceName: fullName,              // ✅ full name for tooltip
      xAxisName: fullName.split(' ')[0],      // ✅ FIRST WORD ONLY
    };
  })
  .sort((a, b) => b.totalTraffic - a.totalTraffic)
  .slice(0, 10);

  }, [data, trafficType, serviceNameMap]);

  const maxValue = Math.max(...top10Data.map(d => d.totalTraffic || 0));
  const yAxisMax = maxValue > 0 ? Math.ceil(maxValue * 1.1) : 100;

  const getBarColor = () => {
    switch (trafficType) {
      case 'clean':
        return '#86efac';
      case 'bot':
        return '#fca5a5';
      default:
        return '#93c5fd';
    }
  };

  return (
    <div className="bg-white border rounded p-4 shadow w-full">
      <div className="flex justify-between items-center mb-2">
        <span className="font-bold">
          Top 10 Services by {trafficType.charAt(0).toUpperCase() + trafficType.slice(1)} Traffic
        </span>

        {/* Dropdown – no bold focus */}
        <select
          value={trafficType}
          onChange={(e) => setTrafficType(e.target.value as TrafficType)}
          className="
            border border-gray-300 rounded px-3 py-1 text-sm
            focus:outline-none focus:ring-0 focus:border-gray-300
          "
        >
          <option value="total">Total Traffic</option>
          <option value="clean">Clean Traffic</option>
          <option value="bot">Bot Traffic</option>
        </select>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        {top10Data.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
          <BarChart
            data={top10Data}
            margin={{ top: 16, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />

            {/* X Axis – SAME size & style as traffic source */}
            <XAxis
              dataKey="xAxisName"
              tick={{ fontSize: 10, fill: '#666' }}
              angle={-45}
              textAnchor="end"
              height={60}
            />



            <YAxis
              tick={{ fontSize: 12, fill: '#666' }}
              domain={[0, yAxisMax]}
            />

            {/* Tooltip – EXACT SAME STYLE AS FIRST CHART */}
            <Tooltip
              cursor={{ fill: 'rgba(220, 211, 211, 0.05)' }}
              formatter={(value: any, _n: any, props: any) => [
                Number(value).toLocaleString(),
                props.payload.fullServiceName,
              ]}
              labelFormatter={() => ''}
              contentStyle={{
                backgroundColor: 'white',
                borderRadius: '6px',
                border: 'none',
                color: 'black',
                padding: '6px 10px',
                fontSize: '12px',
              }}
            />

            <Bar
              dataKey="totalTraffic"
              fill={getBarColor()}
              radius={[4, 4, 0, 0]}
              barSize={20}
            />

            <Legend
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{
                fontSize: '12px',
                marginTop: '-10px',
              }}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
