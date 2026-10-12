type RowType = {
  date: string;
  BannerDisplay: number;
  CTA1: number;
  CTA2: number;
  sdpSuccess: number;
  CallbackSuccess: number;
};

export default function ConversionRateTable({ chartData }: { chartData: RowType[] }) {
  const calculateConversionRate = (current: number, previous: number): string => {
    if (previous === 0) return '0%';
    return `${Math.round((current / previous) * 100)}%`;
  };

  const sortedData = chartData
    ? [...chartData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];

  return (
    <div className="bg-white border rounded p-4 shadow">
      <div className="font-bold mb-2">Conversion Rate Analysis</div>

      {/* ✅ ONLY SCROLL CONTAINER */}
      <div className="table-scroll scrollbar-thin">
        {!sortedData || sortedData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">No data found</div>
        ) : (
          <table className="sticky-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>CTA-1</th>
                <th>CTA-2</th>
                <th>SDP Success</th>
                <th>Callback Success</th>
              </tr>
            </thead>

            <tbody>
              {sortedData.map((row, index) => (
                <tr key={index}>
                  <td>{row.date}</td>
                  <td>{calculateConversionRate(row.CTA1, row.BannerDisplay)}</td>
                  <td>{calculateConversionRate(row.CTA2, row.CTA1)}</td>
                  <td>{calculateConversionRate(row.sdpSuccess, row.CTA2)}</td>
                  <td>{calculateConversionRate(row.CallbackSuccess, row.sdpSuccess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ✅ CSS — THIS MAKES STICKY BULLETPROOF */}
      <style>
        {`
          .table-scroll {
            max-height: 300px;
            overflow-y: auto;
            overflow-x: auto;
            position: relative;
          }

          .sticky-table {
            width: 100%;
            border-collapse: collapse;
          }

          .sticky-table thead {
            position: sticky;
            top: 0;
            z-index: 20;
            background: #f4f4f4;
          }

          .sticky-table th,
          .sticky-table td {
            border: 1px solid #ccc;
            padding: 0.5rem;
            font-size: 12px;
            text-align: center;
            background: white;
          }

          .sticky-table th {
            font-weight: bold;
            background: #f4f4f4;
          }

          .sticky-table tbody tr:nth-child(even) {
            background: #f9f9f9;
          }

          /* Scrollbar */
          .scrollbar-thin::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .scrollbar-thin::-webkit-scrollbar-thumb {
            background-color: #d3d3d3;
            border-radius: 10px;
          }
          .scrollbar-thin::-webkit-scrollbar-thumb:hover {
            background-color: #b5b5b5;
          }
        `}
      </style>
    </div>
  );
}
