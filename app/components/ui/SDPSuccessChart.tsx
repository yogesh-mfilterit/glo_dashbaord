import { ChartTooltip, ChartLegend } from "./chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList } from "recharts";
import { formatDbDate } from "~/lib/utils";

export function SDPSuccessChart({ data }: { data: { dbDate: string; total: number }[] }) {
  // Calculate total sum
  const totalSum = data.reduce((sum, item) => sum + item.total, 0);
  
  return (
    <div className="bg-white border rounded p-4 shadow">
      <div className="font-bold mb-2 flex justify-between items-center">
        <span>SDP Success</span>
        <span className="text-sm font-normal text-gray-600">Total: {totalSum.toLocaleString()}</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="dbDate" 
            tickFormatter={formatDbDate}
            tick={{ fontSize: 10, fill: '#666' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis />
          <Area 
            type="monotone" 
            dataKey="total" 
            stroke="#ffc658" 
            fill="#ffc658" 
            fillOpacity={0.2} 
            strokeWidth={2}
            name="SDP Success"
          >
            <LabelList dataKey="total" position="top" style={{ fontSize: '12px', fill: '#666' }} />
          </Area>
          <ChartTooltip />
          <ChartLegend />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
} 