export default function Card({ Title, Type, Date, Time, Officer=0 }) {
    return (
        <div className="bg-white rounded-lg shadow-md p-4 w-full h-fit mb-4 text-left">
            <p className="text-black text-xl font-bold mb-2">{Title}</p>
            <p className="text-gray-700 text-base mb-1">ประเภท: {Type}</p>
            <p className="text-gray-700 text-base mb-1">{Date} - {Time}</p>
        </div>
    );
}
