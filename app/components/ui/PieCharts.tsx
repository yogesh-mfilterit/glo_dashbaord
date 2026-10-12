import {
  PieChart,
  Pie,
  Tooltip,
  Cell,
} from "recharts";

interface PieChartComponentProps {
  data: Array<{
    name: string;
    value: number;
  }>;
  title?: string;
}

export default function PieChartComponent({ data, title }: PieChartComponentProps) {
  const COLORS = [
    "#FF6633", "#FFB399", "#FF33FF", "#FFFF99", "#00B3E6",
    "#E6B333", "#3366E6", "#999966", "#99FF99", "#B34D4D",
    "#80B300", "#809900", "#E6B3B3", "#6680B3", "#66991A",
    "#FF99E6", "#CCFF1A", "#FF1A66", "#E6331A", "#33FFCC",
    "#66994D", "#B366CC", "#4D8000", "#B33300", "#CC80CC",
    "#66664D", "#991AFF", "#E666FF", "#4DB3FF", "#1AB399",
    "#E666B3", "#33991A", "#CC9999", "#B3B31A", "#00E680",
    "#4D8066", "#809980", "#1AFF33", "#999933", "#FF3380",
    "#CCCC00", "#66E64D", "#4D80CC", "#9900B3", "#E64D66",
    "#4DB380", "#FF4D4D", "#99E6E6", "#6666FF", "#3B9C9C",
    "#DA70D6", "#F08080", "#CD853F", "#B0C4DE", "#5F9EA0",
    "#8A2BE2", "#D2691E", "#9ACD32", "#6495ED", "#DC143C",
    "#20B2AA", "#FF6347", "#7FFFD4", "#FFD700", "#6A5ACD",
    "#FF4500", "#ADFF2F", "#00FA9A", "#800000", "#00CED1",
    "#A0522D", "#8B0000", "#C71585", "#F0E68C", "#7B68EE",
    "#00FF7F", "#F4A460", "#8FBC8F", "#0000CD", "#D2B48C",
    "#191970", "#BA55D3", "#00FF00", "#CD5C5C", "#9932CC",
    "#FF1493", "#1E90FF", "#FF8C00", "#6B8E23", "#FF7F50",
    "#2E8B57", "#708090", "#DAA520", "#FA8072", "#87CEEB",
    "#48D1CC", "#BDB76B", "#EE82EE", "#4169E1", "#B22222",
    "#228B22", "#DEB887", "#00BFFF", "#F5DEB3", "#9400D3"
  ];

  const total = data.reduce((acc, entry) => acc + entry.value, 0);

  const sortedData = [...data].sort((a, b) => b.value - a.value);

  return (
    <div className="bg-white border rounded p-4 shadow flex flex-col">
      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px; /* thinner vertical scrollbar */
            height: 4px; /* thinner horizontal scrollbar */
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: #d1d5db;
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background-color: #9ca3af;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background-color: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-horizontal {
            display: none; /* hide horizontal scrollbar */
          }
        `}
      </style>

      <div className="font-bold mb-2 flex justify-between items-center">
        <span>{title}</span>
      </div>

      <div className="flex flex-col md:flex-row items-start justify-between">
        {/* Donut Chart */}
        <div className="flex justify-center items-center">
          <PieChart width={310} height={300}>
            {sortedData.length > 0 ? (
              <Pie
              isAnimationActive={false}
                data={sortedData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                fill="#8884d8"
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                minAngle={2}
              >
                {sortedData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
            ) : (
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#6B7280"
                fontSize="14px"
              >
                No data found
              </text>
            )}
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div
                      style={{
                        backgroundColor: "#f3f4f6",
                        borderRadius: "8px",
                        padding: "8px",
                        fontSize: "12px",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                      }}
                    >
                      <p
                        style={{
                          color: "black",
                          fontWeight: "bold",
                          marginBottom: "4px",
                        }}
                      >
                        {label}
                      </p>
                      {payload.map((entry, idx) => (
                        <p
                          key={idx}
                          style={{ color: entry.color, margin: 0 }}
                        >
                          {entry.name} : {entry.value}
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
          </PieChart>
        </div>

        {/* Custom Legend */}
        <div className="flex flex-col text-sm max-h-[300px] overflow-y-auto w-full md:w-[300px] custom-scrollbar">
          {sortedData.map((entry, index) => {
            const truncatedLabel =
              entry.name.length > 15
                ? `${entry.name.slice(0, 15)}...`
                : entry.name;
            const percentage = ((entry.value / total) * 100).toFixed(1);

            return (
              <div
                key={index}
                className="flex items-start mb-1"
                style={{ lineHeight: "1.2em" }}
              >
                <div
                  className="w-3 h-3 mt-1 mr-2 rounded flex-shrink-0"
                  style={{
                    backgroundColor: COLORS[index % COLORS.length],
                  }}
                ></div>
                <div className="flex flex-col text-left">
                  <span
                    className="text-[10px] text-wrap break-words max-w-[240px]"
                    title={entry.name}
                  >
                    {truncatedLabel}
                  </span>
                  <span className="text-[9px] text-gray-600">
                    {entry.value} ({percentage}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
