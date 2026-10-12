import { FunctionComponent } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from "recharts";



const CustomizedLabel: FunctionComponent<any> = ({ x, y, value }) => {
  if (value === 0 || value === null || value === undefined) return null;

  return (
    <text
      x={x}
      y={y - 15} // This lifts the label above the point
      dy={2}
      fill="#555"
      fontSize={10}
    
      textAnchor="middle"
    >
      {}
    </text>
  );
};

interface LineChartComponentProps {
  chartData: Array<{
    date: string;
    totalTraffic: number;
    cg1ClickedCount: number,
    cg2ClickedCount: number
  }>;
}

export default function LineChartComponent({ chartData }: LineChartComponentProps) {
  return <div className="w-full overflow-hidden bg-gray-50 dark:bg-gray-800 rounded-lg">
    <div className="bg-white border rounded p-4 shadow">
      <div className="font-bold mb-2 flex justify-between items-center">
        <span>Total CTA-1 and CTA-2 Traffic</span>
      </div>
      
      <ResponsiveContainer width="100%" height={300}>
        {!chartData || chartData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
          <LineChart
            width={500}
            height={300}
            data={chartData}
            margin={{
              top: 20,
              right: 30,
              bottom: 10,
            }}
          >
            <XAxis
              dataKey="date"
              fontSize={10}
              height={50}
              interval={0}
              angle={-35}
              dy={10}
            />

            <YAxis fontSize={12} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div
                      style={{
                        backgroundColor: "#f3f4f6", // here color change : analyze and fix
                        borderRadius: "8px",
                        padding: "8px",
                        fontSize: "12px",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
                      }}
                    >
                      {/* Date on top with black text */}
                      <p style={{ color: "black", fontWeight: "bold", marginBottom: "4px" }}>
                        {label}
                      </p>

                      {/* Tooltip content */}
                      {payload.map((entry, index) => {
                        let color = entry.color;
                        return (
                          <p key={index} style={{ color: color, margin: 0 }}>
                            {entry.name} : {entry.value}
                          </p>
                        );
                      })}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              layout="horizontal"
              align="center"
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: "12px" }} />
            <Line
              type="monotone"
              dataKey="totalTraffic"
              stroke="#8884d8"
              name="Total Traffic"
              strokeWidth={2}
            >
              <LabelList content={<CustomizedLabel />} />
            </Line>
            <Line
              type="monotone"
              dataKey="cg1ClickedCount"
              stroke="#3b82f6"
              name="CTA 1 Clicked"
              strokeWidth={2}
            >
              <LabelList content={<CustomizedLabel />} />
            </Line>
            <Line
              type="monotone"
              dataKey="cg2ClickedCount"
              stroke="#FFBB28"
              name="CTA 2 Clicked"
              strokeWidth={2}
            >
              <LabelList content={<CustomizedLabel />} />
            </Line>
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  </div>

}