import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

// Show service name (not id) - service names are now provided directly from data processing
export function Top5BotServicesChart({
  data,
  serviceList,
}: {
  data: { dbDate: string; serviceName: string; count: number }[];
  serviceList: { serviceId: string; serviceIdName: string }[];
}) {
  console.log('Top5BotServicesChart - Data:', data);

  // Safety checks for empty data
  if (!data || data.length === 0) {
    return (
      <div className="bg-white border rounded p-4 shadow w-full">
        <div className="font-bold mb-2 flex justify-between items-center">
          <span>Top 5 Blocked Services</span>
        </div>
        <div className="h-64 w-full flex items-center justify-center text-gray-500">
          No data found
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map(item => item.count || 0));
  const xAxisMax = maxCount > 0 ? Math.ceil(maxCount * 1.1) : 100;

  // Truncate service name to max 10 words or 60 characters
  const truncateServiceName = (name: string) => {
    if (!name || typeof name !== 'string') return 'Unknown Service';
    const words = name.split(" ");
    if (words.length > 10) return words.slice(0, 10).join(" ") + " ...";
    if (name.length > 60) return name.slice(0, 60) + " ...";
    return name;
  };

  // Process data for display - service names are already resolved
  const updatedData = data.map((item) => {
    // Ensure minimum visibility for very small values
    const minVisibleCount = Math.max(item.count || 0, 1);
    return {
      ...item,
      serviceName: item.serviceName || 'Unknown Service',
      count: item.count || 0,
      displayCount: minVisibleCount, // For display purposes
      truncatedName: truncateServiceName(item.serviceName),
    };
  });

  return (
    <div className="bg-white border rounded p-4 shadow w-full">
      <div className="font-bold mb-2 flex justify-between items-center">
        <span>Top 5 Blocked Services</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        {!updatedData || updatedData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
          <BarChart
            layout="vertical"
            data={updatedData}
            margin={{ top: 16, right: 30, left: 56, bottom: 16 }}
          >
            <YAxis
              dataKey="truncatedName"
              type="category"
              tick={{ fontSize: 11, fill: "#555" }}
              width={1}
            />
            <XAxis
              type="number"
              domain={[0, xAxisMax]}
              tick={{ fontSize: 12 }}
            />
            <Bar
              dataKey="displayCount"
              fill="#ff751a"
              name="Blocked Services"
              radius={[0, 4, 4, 0]}
              barSize={20}
            />
            <Tooltip
              cursor={{ fill: "rgba(220, 211, 211, 0.05)" }}
              formatter={(value: any, _name: any, props: any) => {
                // Show the actual count in tooltip, not the display count
                const actualCount = props.payload.count;
                const displayText = actualCount === 0 ? "0 (minimal visibility)" : `${actualCount}`;
                return [displayText, props.payload.serviceName];
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
