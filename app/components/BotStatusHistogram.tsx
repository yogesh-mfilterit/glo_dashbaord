import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface ChartDataPoint {
  date: string;
  clean: number;
  bot: number;
}

interface BotStatusHistogramProps {
  data: ChartDataPoint[];
  loading?: boolean;
  error?: string | null;
}

export function BotStatusHistogram({ data, loading = false, error = null }: BotStatusHistogramProps) {

  // Format date for chart display (e.g., "2025-08-01" -> "Aug 01")
  function formatDateForChart(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: '2-digit' 
    });
  }

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Bot Status Distribution</h3>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading bot status data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Bot Status Distribution</h3>
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Bot Status Distribution</h3>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">No data available for the selected date range</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">Bot Status Distribution</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="date" 
            angle={-45}
            textAnchor="end"
            height={80}
            fontSize={12}
          />
          <YAxis fontSize={12} />
          <Tooltip 
            formatter={(value: number, name: string) => [
              value.toLocaleString(), 
              name === 'clean' ? 'Clean' : 'Bot'
            ]}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Legend 
            formatter={(value) => value === 'clean' ? 'Clean' : 'Bot'}
          />
          <Bar dataKey="clean" fill="#10b981" name="clean" />
          <Bar dataKey="bot" fill="#ef4444" name="bot" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
} 