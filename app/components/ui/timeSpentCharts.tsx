import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TimeSpentChartsProps {
  chartData: { date: string; cg1Time: number; cg2Time: number }[];
}

export default function TimeSpentCharts({ chartData }: TimeSpentChartsProps) {
  // Check if there's no data or empty data
  const hasData = chartData && chartData.length > 0;

  return (
    <div className="bg-white border rounded p-4 shadow w-full">
      <div className="font-bold mb-2">Service-wise Time Spent (in seconds)</div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 16, left: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
            <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}`} fontSize={12} />
           {/* <YAxis fontSize={12} /> */}
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                borderRadius: "6px",
                border: "none",
                color: "black",
                padding: "6px 10px",
                fontSize: "12px",
              }}
              formatter={(value: any, name: any) => {
                const label = name === 'CTA1 Time' ? 'CTA1 Time' : 'CTA2 Time';
                const num = Number(value);
                return [`${isNaN(num) ? 0 : num.toFixed(2)} sec`, label];
              }}
            />
            <Legend 
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{
                fontSize: '12px',
                marginTop: '-10px'
              }}
            />
            <Bar barSize={20} dataKey="cg1Time" name="CTA1 Time" fill="#7e22ce" />
            <Bar barSize={20} dataKey="cg2Time" name="CTA2 Time" fill="#ff6633" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[300px] text-gray-500">
          <div className="text-center">
            <div className="text-lg font-medium">No data found</div>
            <div className="text-sm">There is no time spent data available for the selected period.</div>
          </div>
        </div>
      )}
    </div>
  );
}