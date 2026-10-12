import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
} from "recharts";

interface TrafficData {
  date: string;
  totalTraffic: number;
  legitimateTraffic: number;
  botTraffic: number;
  botPercentage: number;
}

export function TotalTrafficNewChart({ data }: { data: TrafficData[] }) {
  return (
    <div className="w-full h-[400px] bg-white p-2 rounded shadow">
      <h2 className="text-base font-semibold mb-2">Total Traffic Analysis</h2>
      <ResponsiveContainer width="100%" height="90%">
        {!data || data.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
        <ComposedChart
        
          data={data}
          margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
          barGap={0}
        >
       
          <XAxis 
            dataKey="date" 
            angle={-45}
            textAnchor="end"
            height={50}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
            tick={{ fontSize: 10 }}
            // label={{ value: 'Traffic Volume', angle: 90, position: 'insideRight', fontSize: 10 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            tick={{ fontSize: 10 }}
            // label={{ value: 'Bot Percentage', angle: -90, position: 'insideRight', fontSize: 10 }}
          />
          <Tooltip
                contentStyle={{
                  backgroundColor: "#f3f4f6", // here color change : analyze and fix
                  borderRadius: "8px",
                  padding: "8px",
                  fontSize: "12px",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
                }}
            formatter={(value: number, name: string) => {
              switch (name) {
                case "legitimateTraffic":
                  return [`${value.toLocaleString()} requests`, "Legitimate Traffic"];
                case "botTraffic":
                  return [`${value.toLocaleString()} requests`, "Bot Traffic"];
                case "botPercentage":
                  return [`${value.toFixed(1)}%`, "Bot Percentage"];
                default:
                  return [value, name];
              }
            }}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Legend 
            verticalAlign="bottom" 
            height={20}
            wrapperStyle={{
              fontSize: '11px',
              marginTop: '-10px'
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="totalTraffic"
            fill="#87CEEB"
            name="Total Traffic"
            stackId="a"
            barSize={30}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="legitimateTraffic"
            fill="#4CAF50"
            name="Clean Traffic"
            stackId="a"
            barSize={30}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="botTraffic"
            fill="#FF8A80"
            name="Bot Traffic"
            stackId="a"
            barSize={30}
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="botPercentage"
            stroke="red"
            strokeWidth={3}
            name="Bot %"
            dot={{ r: 4, fill: '#B22222' }} // dark red
            activeDot={{ r: 6 }}
            label={({ x, y, value }) => (
              <text
                x={x}
                y={y - 10}
                fill="red"
                fontSize={12}
                textAnchor="middle"
                fontWeight="bold"
              >
               {}
              </text>
            )}
          />
        </ComposedChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
