export default function Card({ title, content }) {
    return (
        <div className="bg-white rounded-lg shadow-md p-4 w-full h-fit mb-4">
            <p className="text-black text-xl font-bold mb-2">{title}</p>
            <p className="text-gray-500">{content}</p>
        </div>
    );
}