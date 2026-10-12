
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from "recharts";

export function Top5TrafficSourceChart({
  data,
}: {
  data: { dbDate: string; trafficSource: string; count: number }[] | any;
}) {
  console.log('Top5TrafficSourceChart - Data received:', data);
  
  // Handle different data structures
  let chartData: { dbDate: string; trafficSource: string; count: number }[] = [];
  
  if (Array.isArray(data)) {
    chartData = data;
  } else if (data && data.data && Array.isArray(data.data)) {
    chartData = data.data;
  } else if (data && Array.isArray(data)) {
    chartData = data;
  }
  
  console.log('Top5TrafficSourceChart - Processed chart data:', chartData);
  
  // Sort by count and get top 5
  const sortedData = chartData
    .filter(item => item && item.trafficSource && item.count > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 5);

  // Truncate traffic source names
  const truncateTrafficSource = (name: string) => {
    if (!name || typeof name !== 'string') return 'Unknown Source';
    if (name.length > 20) return name.slice(0, 20) + '...';
    return name;
  };

  const processedData = sortedData.map((item) => ({
    ...item,
    trafficSource: item.trafficSource || 'Unknown Source',
    count: item.count || 0,
    truncatedName: truncateTrafficSource(item.trafficSource),
  }));

  const totalSum = processedData.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...processedData.map(item => item.count || 0));
  const xAxisMax = maxCount > 0 ? Math.ceil(maxCount * 1.1) : 100;

  return (
    <div className="bg-white border rounded p-4 shadow w-full">
      <div className="font-bold mb-2 flex justify-between items-center">
        <span>Top 5 Blocked Traffic Sources</span>
     
      </div>

      <ResponsiveContainer width="100%" height={300}>
        {!processedData || processedData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
        <BarChart
          data={processedData}
          margin={{ top: 16, right: 30, left: 20, bottom: 60 }}
        >
          {/* X-axis (traffic source labels) */}
          <XAxis
            dataKey="truncatedName"
            tick={{ fontSize: 10, fill: "#666" }}
            angle={-45}
            textAnchor="end"
            height={60}
          />

          {/* Y-axis (count values) */}
          <YAxis 
            tick={{ fontSize: 12, fill: "#666" }}
            domain={[0, xAxisMax]}
          />


          {/* Bars */}
          <Bar
            dataKey="count"
            fill="#8884d8"
            name="Blocked Traffic Sources"
            radius={[4, 4, 0, 0]} // rounded top corners
            barSize={20}
          />

          {/* Tooltip */}
          <Tooltip
            cursor={{ fill: "rgba(220, 211, 211, 0.05)" }}
            formatter={(value: any, _name: any, props: any) => {
              const originalId = props.payload.originalId;
              const displayText = originalId && originalId !== props.payload.trafficSource 
                ? `${props.payload.trafficSource} (ID: ${originalId})` 
                : props.payload.trafficSource;
              return [`${value}`, displayText];
            }}
            labelFormatter={() => ""}
            contentStyle={{
              backgroundColor: "white",
              borderRadius: "6px",
              border: "none",
              color: "black",
              padding: "6px 10px",
              fontSize: "12px",
            }}
          />

          {/* Legend */}
          <Legend 
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{
              fontSize: '12px',
              marginTop: '-10px'
            }}
          />
        </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
