import { ChartLegend } from "./chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,Legend } from "recharts";

export function Top5BlockedCPChart({
  data,
  cpdata,
}: {
  data: { dbDate: string; cpId: string; cpName: string; count: number }[];
  cpdata: { cpid: string; cpName: string }[];
}) {
  const totalSum = data.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...data.map(item => item.count));
  const xAxisMax = Math.ceil(maxCount * 1.1); // Add 10% padding to max value
  console.log("cpdata:", cpdata);

  return (
    <div className="bg-white border rounded p-4 shadow w-full">
      <div className="font-bold mb-2 flex justify-between items-center">
        <span>Top 5 Blocked CPs</span>

      </div>
      
      <ResponsiveContainer width="100%" height={300}>
        {!data || data.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 16, right: 30, bottom: 16 }}
        >
          {/* <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} /> */}

          {/* X-axis (counts) */}
          <XAxis
            type="number"
            domain={[0, xAxisMax]}
            tick={{ fontSize: 12 }}
          />

          {/* Y-axis (CP labels) */}
          <YAxis
  type="category"
  dataKey={(item) => {
    const cpInfo = cpdata.find(cp => cp.cpid === item.cpId);
    return cpInfo ? cpInfo.cpName : item.cpId;
  }}
  tick={({ x, y, payload }) => {
    const cpInfo = cpdata.find(cp => cp.cpid === payload.value);
    const fullName = cpInfo ? cpInfo.cpName : payload.value;
    const shortName = fullName.length > 6 ? fullName.slice(0, 6) + "..." : fullName;

    return (
      <text
        x={x}
        y={y + 4}
        width={70}
        textAnchor="end"
        fill="#666"
        fontSize={12}
        // title={fullName} // This will show full name on hover
      >
        {shortName}
      </text>
    );
  }}
  width={70}
/>



          {/* Bars */}
          <Bar
            dataKey="count"
            fill="#3b82f6"
            name="Blocked CPs"
            barSize={20}
            radius={[0, 4, 4, 0]}
          />

          {/* Tooltip */}
          <Tooltip
            cursor={{ fill: "rgba(220, 211, 211, 0.05)" }}
            formatter={(value: any, _name: any, props: any) => {
              const cpInfo = cpdata.find(cp => cp.cpid === props.payload.cpId);
              const cpName = cpInfo ? cpInfo.cpName : props.payload.cpId;
              return [`${cpName}: ${value}`];
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
