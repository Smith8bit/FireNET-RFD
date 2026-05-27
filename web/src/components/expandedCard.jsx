import { useSocketStore } from "../functions/stateStore";
export default function ExpandedCard({firespot}) {

    const send = useSocketStore((s) => s.send)

    return (
        <div id='container' className="bg-white w-full h-full p-4">
            <p className="text-xl font-bold">{firespot?.TUMBOON}</p>
            <p>Lan: {firespot?.LATITUDE} Long: {firespot?.LONGITUDE}</p>
            <button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={() => send({ msg :"Hello @ "+firespot?.LATITUDE})}>SEND</button>
        </div>
    );
}